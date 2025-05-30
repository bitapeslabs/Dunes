/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

/* ── external deps ─────────────────────────────────────────────────────────── */
import { Op } from "sequelize";
import { Vin, Vout, Transaction, Block } from "@/lib/apis/bitcoinrpc/types";
import { createRpcClient, RpcClient } from "./apis/bitcoinrpc";
import {
  convertAmountToParts,
  convertPartsToAmount,
  chunkify,
  btcToSats,
  log,
  isValidResponse,
} from "./utils";
import {
  IMezcalstoneIndexed,
  decipher as decipherMezcalstoneRaw,
} from "./mezcalstone";
import { IMezcal, ITransaction } from "@/database/models/types";
/* ── constants ────────────────────────────────────────────────────────────── */
import { GENESIS_BLOCK } from "./consts";
import { IStorage } from "@/lib/storage";
import { IAddress } from "@/database/models/types";
import { IndexedTxExtended } from "./indexer";
import { chunkifyIter } from "./utils";

/* ── shared types ─────────────────────────────────────────────────────────── */
type RpcCall = <T>(method: string, params?: unknown[]) => Promise<T>;

export interface IndexedTx extends Transaction {
  mezcalstone: IMezcalstoneIndexed;
  hash: string;
  txIndex: number;
  block: number;
  vout: Vout[];
  vin: Vin[];
  full_tx: Transaction;
}

/* ── helpers from original JS (comments preserved) ────────────────────────── */

/**
 * Decipher OP_RETURN → mezcalstone payload. Wrapper keeps signature identical.
 */
const decipherMezcalstone = (txJson: Transaction) =>
  decipherMezcalstoneRaw(txJson);

/**
 * A transaction is useful for the indexer if it contains a cenotaph, mint,
 * or etching operation.
 */
const isUsefulMezcalTx = (tx: IndexedTx): boolean => {
  const { mezcalstone } = tx;
  if (mezcalstone?.cenotaph) return true; // burn happens
  if (mezcalstone?.mint || mezcalstone?.etching || mezcalstone?.edicts)
    return true;
  return false;
};

/**
 * Fetch a block from RPC and hydrate every tx with its mezcalstone (if any).
 */
const getMezcalstonesInBlock = async (
  blockNumber: number,
  callRpc: RpcCall
): Promise<IndexedTx[]> => {
  const blockHash = await callRpc<string>("getblockhash", [blockNumber]);
  const block = await callRpc<Block>("getblock", [blockHash, 2]);
  return getMezcalstonesFromBlock(block);
};

const getMezcalstonesFromBlock = (block: Block): IndexedTx[] => {
  return block.tx.map((tx, txIndex) => ({
    mezcalstone: decipherMezcalstone(tx),
    hash: tx.txid,
    txIndex,
    block: block.height,
    vout: tx.vout,
    vin: tx.vin,
    full_tx: tx,
    txid: tx.txid,
    size: tx.size,
    vsize: tx.vsize,
    version: tx.version,
    locktime: tx.locktime,
  }));
};

/**
 * Prime local cache with historical data needed by later passes.
 */
const prefetchTransactions = async (
  block: number[],
  storage: IStorage,
  callRpc: RpcCall
) => {
  const { create, findOrCreate } = storage;

  // sentinel addresses
  findOrCreate(
    "Address",
    "COINBASE",
    { address: "COINBASE", block: GENESIS_BLOCK },
    true
  );
  findOrCreate(
    "Address",
    "OP_RETURN",
    { address: "OP_RETURN", block: GENESIS_BLOCK },
    true
  );
  findOrCreate(
    "Address",
    "UNKNOWN",
    { address: "UNKNOWN", block: GENESIS_BLOCK },
    true
  );

  const chunks = chunkify(
    block,
    Number.parseInt(process.env.GET_BLOCK_CHUNK_SIZE ?? "3", 10)
  );

  for (const chunk of chunks) {
    log(`Prefetching blocks: ${Object.values(chunk).join(", ")}`, "info");

    await Promise.all(
      chunk.map(async (blockNumber) => {
        const blockHash = await callRpc<string>("getblockhash", [blockNumber]);
        const blk = await callRpc<Block>("getblock", [blockHash, 2]);

        blk.tx.forEach((transaction) => {
          if (transaction.vin[0].coinbase) return;

          const TransactionModel = create("Transaction", {
            hash: transaction.txid,
          });

          transaction.vout.forEach((utxo) => {
            const address = utxo.scriptPubKey.address;
            if (!address) return; // OP_RETURN

            create("Utxo", {
              value_sats: BigInt(Math.round(utxo.value * 1e8)).toString(),
              block: blockNumber,
              transaction_id: TransactionModel.id,
              address_id: findOrCreate("Address", address, {
                address,
                block: blockNumber,
              }).id,
              vout_index: utxo.n,
            });
          });
        });
      })
    );
  }
};

/**
 * Enrich fetched txs with prev‑out data & resolve senders.
 */
const populateResultsWithPrevoutData = async (
  results: IndexedTx[][],
  callRpc: RpcCall,
  storage: IStorage
): Promise<IndexedTxExtended[][]> => {
  const { loadManyIntoMemory, findOne, local, fetchGroupLocally } = storage;

  /*  We can do this because the indexer can interpret the sender
      from what we have stored in db. */
  const transactionsInChunk = [
    ...new Set(
      results
        .flat()
        .map((tx) => tx.vin.map((v) => v.txid))
        .flat()
        .filter(Boolean)
    ),
  ];

  // Load relevant vins into memory to avoid extra RPC
  for (const chunk of chunkifyIter(transactionsInChunk, 50_000)) {
    await loadManyIntoMemory("Transaction", { hash: { [Op.in]: chunk } });
  }

  let utxosToFetch = Object.values(local.Transaction).map((tx) => tx.id);

  for (const chunk of chunkifyIter(utxosToFetch, 50_000)) {
    await loadManyIntoMemory("Utxo", {
      transaction_id: { [Op.in]: chunk },
    });
  }

  await loadManyIntoMemory("Address", {
    id: {
      [Op.in]: [...new Set(Object.values(local.Utxo).map((u) => u.address_id))],
    },
  });

  log(
    `(BC) Transactions loaded: ${Object.keys(local.Transaction).length}`,
    "debug"
  );
  log(`(BC) UTXOs loaded: ${Object.keys(local.Utxo).length}`, "debug");
  log(`(BC) Addresses loaded: ${Object.keys(local.Address).length}`, "debug");

  // txid → tx map
  const txMapInChunk: Record<string, IndexedTx> = {};
  results.flat().forEach((tx) => {
    txMapInChunk[tx.hash] = tx;
  });

  // main mapping pass
  return Promise.all(
    results.map(async (block) =>
      Promise.all(
        block.map(async (tx) => {
          const { vin, mezcalstone } = tx;

          if (vin[0].coinbase) return { ...tx, sender: "COINBASE" };

          // 2️⃣ reference within current chunk
          const chunkVin = vin.find((v) => txMapInChunk[v.txid]);
          if (chunkVin) {
            const refTx = txMapInChunk[chunkVin.txid];
            return {
              ...tx,
              sender: refTx.vout[chunkVin.vout].scriptPubKey.address,
            };
          }

          // 3️⃣ lookup in DB
          const transaction =
            vin
              .map((v) =>
                findOne<ITransaction>("Transaction", v.txid, undefined, true)
              )
              .filter(Boolean)[0] ?? null;

          if (isValidResponse(transaction)) {
            const senderId = fetchGroupLocally(
              "Utxo",
              "transaction_id",
              transaction.id
            )?.[0]?.address_id;
            if (!senderId) return { ...tx, sender: null };

            const sender = findOne<IAddress>("Address", `${senderId}@REF@id`);
            if (isValidResponse(sender)) {
              return { ...tx, sender: sender.address };
            }
            return { ...tx, sender: "null" };
          }

          // 4️⃣ last resort RPC for mint/etching
          if (mezcalstone?.mint || mezcalstone?.etching) {
            const sender = (
              await callRpc<Transaction>("getrawtransaction", [
                vin[0].txid,
                true,
              ])
            ).vout[vin[0].vout].scriptPubKey.address;

            return { ...tx, sender };
          }

          // non‑mezcal TXs don’t need sender
          return { ...tx, sender: "UNKNOWN" };
        })
      )
    )
  );
};

/* ── block manager/cache ──────────────────────────────────────────────────── */
const blockManager = (
  callRpc: RpcCall,
  latestBlock: number,
  readBlockStorage: IStorage
) => {
  const MAX_BLOCK_CACHE_SIZE = Number.parseInt(
    process.env.MAX_BLOCK_CACHE_SIZE ?? "10",
    10
  );
  const GET_BLOCK_CHUNK_SIZE = Number.parseInt(
    process.env.GET_BLOCK_CHUNK_SIZE ?? "10",
    10
  );

  const cachedBlocks: Record<number, IndexedTxExtended[]> = {};
  let cacheFillProcessing = false;

  const __fillCache = async (requestedBlock: number) => {
    cacheFillProcessing = true;
    let lastBlockInCache = parseInt(Object.keys(cachedBlocks).slice(-1)[0]);
    let currentBlock = lastBlockInCache ? lastBlockInCache + 1 : requestedBlock;

    while (
      currentBlock <= latestBlock &&
      Object.keys(cachedBlocks).length < MAX_BLOCK_CACHE_SIZE
    ) {
      const chunkSize = Math.min(
        GET_BLOCK_CHUNK_SIZE,
        latestBlock - currentBlock + 1
      );

      const results = await Promise.all(
        Array.from({ length: chunkSize }, (_, i) =>
          getMezcalstonesInBlock(currentBlock + i, callRpc)
        )
      );

      const hydrated = await populateResultsWithPrevoutData(
        results,
        callRpc,
        readBlockStorage
      );

      hydrated.forEach((res, idx) => {
        cachedBlocks[currentBlock + idx] = res;
      });

      currentBlock += chunkSize;
      log(`Cache updated, size ${Object.keys(cachedBlocks).length}`, "debug");
    }
    cacheFillProcessing = false;
  };

  const getBlock = (blockNumber: number): Promise<IndexedTxExtended[]> =>
    new Promise((resolve) => {
      let found = cachedBlocks[blockNumber];
      if (found) {
        delete cachedBlocks[blockNumber];
        resolve([...found]);
      }

      if (!cacheFillProcessing) __fillCache(blockNumber);

      const int = setInterval(() => {
        if (cachedBlocks[blockNumber]) {
          found = cachedBlocks[blockNumber];
          delete cachedBlocks[blockNumber];
          clearInterval(int);
          resolve([...found]);
        }
      }, 10);
    });

  return { getBlock };
};

/* ── mezcal‑specific helpers ────────────────────────────────────────────────── */

interface Allocation {
  mezcal_id: string;
  amount: bigint;
}

const updateUnallocated = (
  prev: Record<string, bigint>,
  allocation: Allocation
) => {
  prev[allocation.mezcal_id] =
    (prev[allocation.mezcal_id] ?? 0n) + allocation.amount;
  return prev;
};

/**
 * Determine if minting is open for a given mezcal at block/txIndex.
 */
const isMintOpen = (
  block: number,
  txIndex: number,
  Mezcal: IMezcal,
  mint_offset = false
): boolean => {
  let {
    mints,
    mint_cap,
    mint_start,
    mint_end,
    mint_offset_start: raw_mint_offset_start,
    mint_offset_end: raw_mint_offset_end,
    mezcal_protocol_id,
    unmintable,
  } = Mezcal;
  if (unmintable) return false;

  let [creationBlock, creationTxIndex] = mezcal_protocol_id
    .split(":")
    .map(Number);

  // mints allowed only after etching
  if (block === creationBlock && creationTxIndex === txIndex) return false;
  if (mezcal_protocol_id === "1:0") creationBlock = GENESIS_BLOCK;

  /* ── variable defs per ord spec ────────────────────────────────────────── */
  let mint_offset_start: number =
    Number(raw_mint_offset_start ?? 0) + creationBlock;
  let mint_offset_end: number =
    Number(raw_mint_offset_end ?? Infinity) + creationBlock;

  const total_mints = BigInt(mints) + (mint_offset ? 1n : 0n);
  if (mint_cap && total_mints > BigInt(mint_cap)) return false;

  const starts = [mint_start, mint_offset_start]
    .filter((e) => e !== creationBlock)
    .map(Number);
  const ends = [mint_end, mint_offset_end]
    .filter((e) => e !== creationBlock)
    .map(Number);

  const start =
    starts.length === 2
      ? Math.max(Number(mint_start ?? creationBlock), mint_offset_start)
      : starts[0] ?? creationBlock;
  const end =
    ends.length === 2
      ? Math.min(Number(mint_end ?? mint_offset_end), mint_offset_end)
      : ends[0] ?? Infinity;

  return !(start > block || end < block);
};

/**
 * Ensure a tx meets price terms (amount + pay_to).
 */
function isPriceTermsMet(mezcal: IMezcal, transaction: Transaction): boolean {
  if (mezcal?.price == null) return true; // auto OK

  for (const priceTerms of mezcal.price) {
    const price = BigInt(priceTerms.amount);
    const payTo = priceTerms.pay_to;

    const payOutputs = transaction.vout.filter(
      (v) => v.scriptPubKey?.address === payTo
    );

    if (!payOutputs.length) return false;

    const paid = payOutputs.reduce((acc, v) => acc + btcToSats(v.value), 0n);
    if (!(paid >= price)) return false;
  }
  return true;
}

/* ── exports ─────────────────────────────────────────────────────────────── */
export {
  populateResultsWithPrevoutData,
  getMezcalstonesFromBlock,
  updateUnallocated,
  isMintOpen,
  blockManager,
  getMezcalstonesInBlock,
  convertPartsToAmount,
  convertAmountToParts,
  prefetchTransactions,
  isUsefulMezcalTx,
  isPriceTermsMet,
};
