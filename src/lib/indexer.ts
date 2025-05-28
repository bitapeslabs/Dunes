/* eslint‑disable @typescript-eslint/explicit-module-boundary-types */

/* ────────────────────────────────────────────────────────────────────────────
   ENV + EXTERNAL DEPS
   ────────────────────────────────────────────────────────────────────────── */
import "dotenv/config";
import { Op } from "sequelize";
import { log } from "./utils";
import {
  isMintOpen,
  isPriceTermsMet,
  updateUnallocated,
  IndexedTx,
} from "./mezcalutils";
import { GENESIS_BLOCK, GENESIS_MEZCALTONE, VERBOSE_LOGGING } from "./consts";
import {
  IAddress,
  IBalance,
  ITransaction,
  Models,
} from "@/database/createConnection";
import {
  Transaction as RpcTx,
  Transaction,
  Vin,
  Vout,
} from "@/lib/apis/bitcoinrpc/types";
import { IMezcalstone, IMezcalstoneIndexed } from "@/lib/mezcalstone";
import { IMezcal, IUtxo, IUtxoBalance } from "@/database/createConnection";
import { isPromise } from "util/types";
import { RpcClient } from "./apis/bitcoinrpc";
import { safeStringify } from "./utils";
import { Block } from "@/lib/apis/bitcoinrpc/types";
import { isValidResponse } from "@/lib/utils";

/* ────────────────────────────────────────────────────────────────────────────
   SHARED TYPES
   ────────────────────────────────────────────────────────────────────────── */

type Storage = Awaited<ReturnType<typeof import("./storage").storage>>;

/* dictionary keyed by mezcal_protocol_id holding bigint amounts */
type BigDict = Record<string, bigint>;

type ITransfers = Record<string, Record<string, bigint>>;

type IndexerUtxo = {
  utxo_index: string;
  address_id: number;
  value_sats: string;
  transaction_id: number;
  vout_index: number;
  block: number;
  block_spent: number | null;
  transaction_spent_id: number | null;
  mezcal_balances?: IMezcalBalances;
};

type IPendingUtxos = IndexerUtxo[];

type IMezcalBalances = BigDict;

type IUnallocatedMezcals = BigDict;

const getIndexerLogger = (storage: Storage, hash: string) => {
  const { updateAttribute, findOne } = storage;

  return {
    logindex: (...args: string[]) => {
      if (!VERBOSE_LOGGING) return;
      if (args.length === 0) {
        return;
      }

      let foundTransaction = findOne<ITransaction>(
        "Transaction",
        hash,
        undefined,
        true
      );

      if (!isValidResponse<ITransaction>(foundTransaction)) {
        log(
          `[INDEXER] Transaction with hash ${hash} not found in local cache, skipping log:`,
          ...args
        );
        return;
      }

      updateAttribute(
        "Transaction",
        foundTransaction.hash,
        "logs",
        `${foundTransaction.logs ?? ""}\n${args.join(" ")}`
      );

      return;
    },
  };
};
/*  Runtime transaction shape used by the indexer
    — extends the raw Bitcoin‑RPC transaction                       */
export interface IndexedTxExtended extends IndexedTx {
  /* populated by block‑reader */
  block: number;
  txIndex: number;
  /* decoded OP_RETURN payload */
  mezcalstone: IMezcalstoneIndexed;

  /* set when the tx is inserted into local cache */
  virtual_id?: number;

  /* resolved sender address (string) or COINBASE/UNKNOWN */
  sender?: string | null;
}

/* ────────────────────────────────────────────────────────────────────────────
   GLOBAL FLAGS & DEBUG TIMER
   ────────────────────────────────────────────────────────────────────────── */

let __debug_totalElapsedTime: Record<string, number> = {};
let __timer = 0;

const startTimer = (): void => {
  __timer = Date.now();
};
const stopTimer = (field: string): void => {
  __debug_totalElapsedTime[field] =
    (__debug_totalElapsedTime[field] ?? 0) + Date.now() - __timer;
};

/* ────────────────────────────────────────────────────────────────────────────
   HELPER #1  getUnallocatedMezcalsFromUtxos
   ────────────────────────────────────────────────────────────────────────── */

const getUnallocatedMezcalsFromUtxos = (
  inputUtxos: IndexerUtxo[]
): IUnallocatedMezcals => {
  /*
        Important: Mezcal Balances from this function are returned in big ints in the following format
        {
            [mezcal_protocol_id]: BigInt(amount)
        }

        mezcal_protocol_id => is the mezcal_id used by the Mezcals Protocol and is recognized, 
        different from mezcal_id which is used by the DB for indexing.
    */

  return inputUtxos.reduce<IUnallocatedMezcals>((acc, utxo) => {
    const mezcalBalances =
      utxo.mezcal_balances !== undefined
        ? (Object.entries(utxo.mezcal_balances) as [string, bigint][])
        : [];

    //Sum up all Mezcal balances for each input UTXO
    mezcalBalances.forEach(([proto, amtStr]) => {
      acc[proto] = (acc[proto] ?? 0n) + BigInt(amtStr);
    });

    return acc;
  }, {});
};

/* ────────────────────────────────────────────────────────────────────────────
   HELPER #2  createNewUtxoBodies
   ────────────────────────────────────────────────────────────────────────── */

const createNewUtxoBodies = (
  vout: Vout[],
  Transaction: IndexedTxExtended,
  storage: Storage
) => {
  const { findOrCreate } = storage;
  const { logindex } = getIndexerLogger(storage, Transaction.txid);

  logindex(
    `(createNewUtxoBodies) Creating new UTXO bodies for transaction ${Transaction.txid}`
  );
  return vout.map((out) => {
    logindex(
      `(createNewUtxoBodies) Creating new UTXO body for vout index ${
        out.n
      } with value ${out.value} and address ${
        out.scriptPubKey.address ?? "OP_RETURN"
      }`
    );
    const addressRow = findOrCreate<IAddress>(
      "Address",
      out.scriptPubKey.address ?? "OP_RETURN",
      {
        address: out.scriptPubKey.address ?? "OP_RETURN",
        block: Transaction.block,
      },
      true
    );

    return {
      /*
        SEE: https://docs.ordinals.com/mezcals.html#Burning
        "Mezcals may be burned by transferring them to an OP_RETURN output with an edict or pointer."

        This means that an OP_RETURN vout must be saved for processing edicts and unallocated mezcals,
        however mustnt be saved as a UTXO in the database as they are burnt.

        Therefore, we mark a utxo as an OP_RETURN by setting its address to such
      */
      utxo_index: `${addressRow.id}:${out.n}`,
      address_id: addressRow.id,
      value_sats: BigInt(Math.round(out.value * 1e8)).toString(),
      transaction_id: Transaction.virtual_id!,
      vout_index: out.n,
      block: Number(Transaction.block),
      mezcal_balances: {} as IMezcalBalances,
      block_spent: null as number | null,
      transaction_spent_id: null as number | null,
    };
    //If the utxo is an OP_RETURN, we dont save it as a UTXO in the database
  });
};

/* ────────────────────────────────────────────────────────────────────────────
   HELPER #3  burnAllFromUtxo
   ────────────────────────────────────────────────────────────────────────── */

const burnAllFromUtxo = (utxo: IndexerUtxo, storage: Storage) => {
  const { updateAttribute, findOne } = storage;

  const transaction = findOne<ITransaction>(
    "Transaction",
    utxo.transaction_id.toString() + "@REF@id",
    undefined,
    true
  );

  if (!isValidResponse<ITransaction>(transaction)) {
    return;
  }

  const { logindex } = getIndexerLogger(storage, transaction.hash);
  logindex(
    `(burnAllFromUtxo) Burning all mezcals from UTXO ${utxo.utxo_index}`
  );
  logindex(
    `(burnAllFromUtxo) UTXO has mezcal balances: ${safeStringify(
      utxo.mezcal_balances
    )}`
  );

  if (!utxo.mezcal_balances) {
    return;
  }

  Object.entries(utxo.mezcal_balances).forEach(([mezcalId, amt]) => {
    const mezcal = findOne<IMezcal>("Mezcal", mezcalId, undefined, true);

    logindex(
      `(burnAllFromUtxo) Burning ${amt} of mezcal ${mezcalId} from UTXO ${utxo.utxo_index}`
    );

    if (!isValidResponse<IMezcal>(mezcal)) {
      logindex(
        `(burnAllFromUtxo) Mezcal ${mezcalId} not found in local cache, skipping burn`
      );
      throw new Error("Invalid response from local cache");
    }

    updateAttribute(
      "Mezcal",
      mezcalId,
      "burnt_amount",
      (BigInt(mezcal.burnt_amount ?? "0") + BigInt(amt)).toString()
    );
  });
};

/* ────────────────────────────────────────────────────────────────────────────
   HELPER #4  updateOrCreateBalancesWithUtxo
   ────────────────────────────────────────────────────────────────────────── */

const updateOrCreateBalancesWithUtxo = (
  utxo: IndexerUtxo,
  storage: Storage,
  direction: 1 | -1,
  transaction: Transaction
): void => {
  const { logindex } = getIndexerLogger(storage, transaction.txid);

  logindex(
    `(updateOrCreateBalancesWithUtxo) Updating or creating balances for UTXO ${utxo.utxo_index} with direction ${direction}`
  );

  const { findManyInFilter, create, updateAttribute, findOne } = storage;
  if (!utxo.mezcal_balances) {
    logindex(
      `(updateOrCreateBalancesWithUtxo) UTXO ${utxo.utxo_index} has no mezcal balances, skipping balance update`
    );
    return;
  }
  const entries = Object.entries(utxo.mezcal_balances);

  //OR‑of‑ANDs filter to preload all involved mezcals
  let mezcalsMapResponse = findManyInFilter<IMezcal>(
    "Mezcal",
    entries.map(([proto]) => proto),
    true
  );

  if (!isValidResponse<IMezcal[]>(mezcalsMapResponse)) {
    logindex(
      `(updateOrCreateBalancesWithUtxo) Invalid response from local cache for mezcals: ${safeStringify(
        entries.map(([proto]) => proto)
      )}`
    );

    throw new Error("Invalid response from local cache");
  }

  logindex(
    `(updateOrCreateBalancesWithUtxo) Found mezcals: ${safeStringify(
      mezcalsMapResponse.map((m) => m.mezcal_protocol_id)
    )}`
  );

  const mezcalsMap = mezcalsMapResponse.reduce<Record<string, any>>(
    (a, d: any) => {
      a[d.mezcal_protocol_id] = d;
      a[d.id] = d;
      return a;
    },
    {}
  );

  logindex(
    `(updateOrCreateBalancesWithUtxo) Mezcals map: ${safeStringify(
      Object.keys(mezcalsMap)
    )}`
  );

  const balanceFilter = entries.map(
    ([proto]) => `${utxo.address_id}:${mezcalsMap[proto].id}`
  );

  logindex(
    `(updateOrCreateBalancesWithUtxo) Balance filter: ${safeStringify(
      balanceFilter
    )}`
  );

  const existingBalancesResponse = findManyInFilter<IBalance>(
    "Balance",
    balanceFilter,
    true
  );

  logindex(
    `(updateOrCreateBalancesWithUtxo) Existing balances response: ${safeStringify(
      existingBalancesResponse
    )}`
  );

  if (!isValidResponse<IBalance[]>(existingBalancesResponse)) {
    logindex(
      `(updateOrCreateBalancesWithUtxo) Invalid response from local cache for existing balances: ${safeStringify(
        balanceFilter
      )}`
    );
    throw new Error("Invalid response from local cache");
  }

  let existingBalances = existingBalancesResponse.reduce<Record<string, any>>(
    (acc, bal: any) => {
      logindex(
        `(updateOrCreateBalancesWithUtxo) Existing balance for ${bal.mezcal_id}: ${bal.balance}`
      );

      acc[mezcalsMap[bal.mezcal_id].mezcal_protocol_id] = bal;
      return acc;
    },
    {}
  );

  for (const [proto, amt] of entries) {
    let bal = existingBalances[proto];

    logindex(
      `(updateOrCreateBalancesWithUtxo) Processing balance for mezcal ${proto} with amount ${amt}`
    );

    if (!bal) {
      let mezcal = findOne<IMezcal>("Mezcal", proto, undefined, true);

      if (!isValidResponse<IMezcal>(mezcal)) {
        logindex(
          `(updateOrCreateBalancesWithUtxo) Mezcal ${proto} not found in local cache, skipping balance creation`
        );

        throw new Error("Invalid response from local cache");
      }

      let mezcalId = mezcal.id;

      bal = create("Balance", {
        mezcal_id: mezcalId,
        address_id: utxo.address_id,
        balance: 0,
      });

      logindex(
        `(updateOrCreateBalancesWithUtxo) Created new balance for mezcal ${proto} with bal: ${safeStringify(
          bal
        )}`
      );
    }

    const newBalance = BigInt(bal.balance) + BigInt(amt) * BigInt(direction);
    logindex(
      `(updateOrCreateBalancesWithUtxo) Updating balance for mezcal ${proto} to ${newBalance}`
    );
    updateAttribute("Balance", bal.balance_index, "balance", newBalance);
  }
};

const processEdicts = (
  UnallocatedMezcals: IUnallocatedMezcals,
  pendingUtxos: IPendingUtxos,
  Transaction: IndexedTxExtended,
  transfers: ITransfers,
  storage: Storage
) => {
  const { logindex } = getIndexerLogger(storage, Transaction.txid);

  const { block, txIndex, mezcalstone, vin } = Transaction;
  const { findManyInFilter, create, findOne, findOrCreate } = storage;

  logindex(
    `(processEdicts) Processing edicts for transaction ${Transaction.txid} at block ${block} and txIndex ${txIndex}`
  );
  logindex(`(processEdicts) Pending UTXOs: ${safeStringify(pendingUtxos)}`);
  logindex(
    `(processEdicts) Unallocated Mezcals: ${safeStringify(UnallocatedMezcals)}`
  );
  logindex(`(processEdicts) Mezcalstone: ${safeStringify(mezcalstone)}`);
  logindex(`(processEdicts) Transaction vin: ${safeStringify(vin)}`);

  let { edicts, pointer } = mezcalstone;

  if (mezcalstone.cenotaph) {
    logindex(
      `(processEdicts) Transaction is a cenotaph, burning all unallocated mezcals`
    );
    //Transaction is a cenotaph, input mezcals are burnt.
    //https://docs.ordinals.com/mezcals/specification.html#Transferring

    transfers.burn = Object.keys(UnallocatedMezcals).reduce((acc, mezcalId) => {
      acc[mezcalId] = UnallocatedMezcals[mezcalId];
      return acc;
    }, {} as Record<string, bigint>);

    return {};
  }

  let allocate = (utxo: IndexerUtxo, mezcalId: string, amount: bigint) => {
    /*
        See: https://docs.ordinals.com/mezcals/specification.html#Trasnferring
        
        An edict with amount zero allocates all remaining units of mezcal id.
      
        If an edict would allocate more mezcals than are currently unallocated, the amount is reduced to the number of currently unallocated mezcals. In other words, the edict allocates all remaining unallocated units of mezcal id.


    */
    let unallocated = UnallocatedMezcals[mezcalId];
    let withDefault =
      unallocated < amount || amount === 0n ? unallocated : amount;

    UnallocatedMezcals[mezcalId] = (unallocated ?? 0n) - withDefault;
    logindex(
      `(processEdicts) Allocating ${withDefault} of mezcal ${mezcalId} to UTXO ${utxo.utxo_index}`
    );

    if (!utxo.mezcal_balances) {
      logindex(
        `(processEdicts) UTXO ${utxo.utxo_index} has no mezcal balances, initializing`
      );
      utxo.mezcal_balances = {};
    }

    utxo.mezcal_balances[mezcalId] =
      (utxo.mezcal_balances[mezcalId] ?? 0n) + withDefault;

    //Dont save transfer events of amount "0"
    if (withDefault === 0n) {
      logindex(
        `(processEdicts) Skipping transfer event for mezcal ${mezcalId} with amount 0`
      );
      return;
    }

    let toAddress = utxo.address_id === 2 ? "burn" : utxo.address_id;
    logindex(
      `(processEdicts) Transferring ${withDefault} of mezcal ${mezcalId} to address ${toAddress}`
    );
    if (!transfers[toAddress]) {
      transfers[toAddress] = {};
      logindex(
        `(processEdicts) Created new transfers entry for address ${toAddress}`
      );
    }
    if (!transfers[toAddress][mezcalId]) {
      transfers[toAddress][mezcalId] = 0n;
      logindex(
        `(processEdicts) Created new transfer entry for mezcal ${mezcalId} to address ${toAddress}`
      );
    }

    transfers[toAddress][mezcalId] += withDefault;
  };

  //References are kept because filter does not clone the array
  let nonOpReturnOutputs = pendingUtxos.filter((utxo) => utxo.address_id !== 2);
  logindex(
    `(processEdicts) Non-OP_RETURN outputs: ${safeStringify(
      nonOpReturnOutputs
    )}`
  );
  if (edicts) {
    const transactionMezcalId = `${block}:${txIndex}`;
    logindex(
      `(processEdicts) Transaction Mezcal ID: ${transactionMezcalId} (block:${block}, txIndex:${txIndex})`
    );
    //Replace all references of 0:0 with the actual mezcal id which we have stored on db (Transferring#5)
    edicts.forEach(
      (edict) =>
        (edict.id = edict.id === "0:0" ? transactionMezcalId : edict.id)
    );

    logindex(`(processEdicts) Processed edicts: ${safeStringify(edicts)}`);

    //Get mezcal ids from edicts for filter below (the mezcal id is the PrimaryKey)
    let edictFilter = edicts.map((edict) => edict.id);
    logindex(`(processEdicts) Edict filter: ${safeStringify(edictFilter)}`);
    //Cache all mezcals that are currently in DB in a hashmap, if a mezcal doesnt exist edict will be ignored

    //uses optimized lookup by using mezcal_protocol_id
    let existingMezcalsResponse = findManyInFilter<IMezcal>(
      "Mezcal",
      edictFilter,
      true
    );
    logindex(
      `(processEdicts) Existing mezcals response: ${safeStringify(
        existingMezcalsResponse
      )}`
    );
    if (!isValidResponse<IMezcal[]>(existingMezcalsResponse)) {
      throw new Error("Invalid response from local cache @ processEdicts:1");
    }

    let existingMezcals = existingMezcalsResponse.reduce(
      (acc, mezcal) => ({ ...acc, [mezcal.mezcal_protocol_id]: mezcal }),
      {} as Record<string, IMezcal>
    );

    logindex(
      `(processEdicts) Existing mezcals: ${safeStringify(
        Object.keys(existingMezcals)
      )}`
    );

    for (let edictIndex in edicts) {
      logindex(
        `(processEdicts) Processing edict at index ${edictIndex}: ${safeStringify(
          edicts[edictIndex]
        )}`
      );
      let edict = edicts[edictIndex];
      //A mezcalstone may contain any number of edicts, which are processed in sequence.
      if (!existingMezcals[edict.id]) {
        logindex(
          `(processEdicts) Mezcal with id ${edict.id} does not exist, ignoring edict`
        );
        //If the mezcal does not exist, the edict is ignored
        continue;
      }

      if (!UnallocatedMezcals[edict.id]) {
        logindex(
          `(processEdicts) Mezcal with id ${edict.id} has no unallocated mezcals, ignoring edict`
        );
        //If the mezcal is not in the unallocated mezcals, it is ignored
        continue;
      }

      if (edict.output === pendingUtxos.length) {
        logindex(
          `(processEdicts) Edict output is equal to the number of transaction outputs, allocating to all non-OP_RETURN outputs: `,
          edict.output.toString(),
          pendingUtxos.length.toString()
        );
        //Edict amount is in string, not bigint
        if (edict.amount === 0n) {
          logindex(
            `(processEdicts) Edict amount is zero, allocating to all non-OP_RETURN outputs`
          );
          /*
              An edict with amount zero and output equal to the number of transaction outputs divides all unallocated units of mezcal id between each non OP_RETURN output.
          */

          const amountOutputs = BigInt(nonOpReturnOutputs.length);
          //By default all txs have exactly one OP_RETURN, because they are needed for mezcalstones. More than 1 OP_RETURN is considered non-standard and ignored by btc nodes.

          /*
            https://github.com/ordinals/ord/pull/3547/commits/30c0b39d398f5f2934c87762f53e0e0591b0aadf?diff=unified&w=0
            AND
            https://twitter.com/raphjaph/status/1782581416716357998/photo/2
          */
          if (amountOutputs > 0) {
            logindex(
              `(processEdicts) Allocating ${
                UnallocatedMezcals[edict.id]
              } of mezcal ${edict.id} to ${amountOutputs} outputs`
            );
            const amount = BigInt(UnallocatedMezcals[edict.id]) / amountOutputs;
            const remainder =
              BigInt(UnallocatedMezcals[edict.id]) % amountOutputs;

            const withRemainder = amount + BigInt(1);

            logindex(
              `(processEdicts) Allocating ${amount} of mezcal ${edict.id} to each output, with a remainder of ${remainder}`
            );

            logindex(
              `(processEdicts) Using NONOPRETURN outputs: ${safeStringify(
                nonOpReturnOutputs
              )}`
            );

            nonOpReturnOutputs.forEach((utxo, index) =>
              allocate(
                utxo,
                edict.id,
                index < remainder ? withRemainder : amount
              )
            );

            logindex(
              `(processEdicts) New unallocated mezcals after allocation: ${safeStringify(
                {
                  [edict.id]: UnallocatedMezcals[edict.id],
                }
              )}`
            );
          }
        } else {
          logindex(
            `(processEdicts) Edict amount is non-zero, allocating ${edict.amount} of mezcal ${edict.id} to all non-OP_RETURN outputs`
          );
          //If an edict would allocate more mezcals than are currently unallocated, the amount is reduced to the number of currently unallocated mezcals. In other words, the edict allocates all remaining unallocated units of mezcal id.
          logindex(
            `(processEdicts) Using NONOPRETURN outputs: ${safeStringify(
              nonOpReturnOutputs
            )}`
          );
          nonOpReturnOutputs.forEach((utxo) =>
            allocate(utxo, edict.id, BigInt(edict.amount))
          );

          logindex(
            `(processEdicts) New unallocated mezcals after allocation: ${safeStringify(
              {
                [edict.id]: UnallocatedMezcals[edict.id],
              }
            )}`
          );
        }
        continue;
      }

      logindex(
        `(processEdicts) Edict output is ${edict.output}, allocating to specific output`
      );
      //Transferring directly to op_return is allowed
      allocate(pendingUtxos[edict.output], edict.id, BigInt(edict.amount));
      logindex(
        `(processEdicts) Allocated ${edict.amount} of mezcal ${edict.id} to output ${edict.output}`
      );
      logindex(
        `(processEdicts) New unallocated mezcals after allocation: ${safeStringify(
          {
            [edict.id]: UnallocatedMezcals[edict.id],
          }
        )}`
      );
    }
  }

  //Transfer remaining mezcals to the first non-opreturn output
  //(edge case) If only an OP_RETURN output is present in the Transaction, transfer to the OP_RETURN

  let pointerOutput = pointer
    ? pendingUtxos[pointer] ?? nonOpReturnOutputs[0]
    : nonOpReturnOutputs[0];

  logindex(`(processEdicts) Pointer output: ${safeStringify(pointerOutput)}`);

  //pointerOutput should never be undefined since there is always either a non-opreturn or an op-return output in a transaction

  if (!pointerOutput) {
    logindex(
      `(processEdicts) Pointer output is undefined, looking for a pending UTXO with address_id 2`
    );
    //pointer is not provided and there are no non-OP_RETURN outputs
    let foundPendingUtxos = pendingUtxos.find((utxo) => utxo.address_id === 2);

    if (foundPendingUtxos) {
      logindex(
        `(processEdicts) Found pending UTXO with address_id 2: ${safeStringify(
          foundPendingUtxos
        )}`
      );
      pointerOutput = foundPendingUtxos;
    } else {
      logindex(`(processEdicts) No pointer output found, throwing error`);
      throw new Error("No pointer output found. This transaction is invalid.");
    }
  }

  logindex(
    `(processEdicts) Pointer output after check: ${safeStringify(
      pointerOutput
    )}`
  );
  //move Unallocated mezcals to pointer output
  Object.entries(UnallocatedMezcals).forEach((allocationData) =>
    allocate(pointerOutput, allocationData[0], allocationData[1])
  );

  logindex(
    `(processEdicts) Final unallocated mezcals after edict processing: ${safeStringify(
      UnallocatedMezcals
    )}`
  );

  //Function returns the burnt mezcals
  return;
};

const processMint = (
  UnallocatedMezcals: IUnallocatedMezcals,
  Transaction: IndexedTxExtended,
  storage: Storage
) => {
  const { logindex } = getIndexerLogger(storage, Transaction.txid);
  const { block, txIndex, mezcalstone } = Transaction;
  const mint = mezcalstone?.mint;

  logindex(
    `(processMint) Processing mint for transaction ${Transaction.txid} at block ${block} and txIndex ${txIndex}`
  );
  logindex(`(processMint) Mezcalstone: ${safeStringify(mezcalstone)}`);
  logindex(`(processMint) Mint: ${mint}`);

  const { findOne, updateAttribute, create, findOrCreate } = storage;

  if (!mint) {
    logindex(
      `(processMint) No mint specified in mezcalstone, returning unallocated mezcals`
    );
    return UnallocatedMezcals;
  }
  //We use the same  process used to calculate the Mezcal Id in the etch function if "0:0" is referred to
  const mezcalToMint = findOne<IMezcal>("Mezcal", mint, undefined, true);

  if (!isValidResponse<IMezcal>(mezcalToMint)) {
    logindex(
      `(processMint) Mezcal with id ${mint} not found in local cache, returning unallocated mezcals`
    );
    //The mezcal requested to be minted does not exist.
    return UnallocatedMezcals;
  }

  if (!isPriceTermsMet(mezcalToMint, Transaction)) {
    logindex(
      `(processMint) Price terms not met for mezcal ${mezcalToMint.id}, returning unallocated mezcals`
    );
    return UnallocatedMezcals;
  }

  logindex(`(processMint) Mezcal to mint: ${safeStringify(mezcalToMint)}`);

  if (isMintOpen(block, txIndex, mezcalToMint, true)) {
    logindex(
      `(processMint) Mint is open for mezcal ${mezcalToMint.id}, processing mint`
    );
    //Update new mints to count towards cap
    if (mezcalstone.cenotaph) {
      logindex(
        `(processMint) Transaction is a cenotaph, burning all unallocated mezcals`
      );
      //If the mint is a cenotaph, the minted amount is burnt
      return UnallocatedMezcals;
    }

    logindex(
      `(processMint) Mint amount: ${
        mezcalToMint.mint_amount
      }, price amount: ${JSON.stringify(mezcalToMint.price)}`
    );

    let mintAmount = BigInt(mezcalToMint.mint_amount ?? "0");
    let isFlex = mezcalToMint.price != null && mintAmount == 0n;

    logindex(
      `(processMint) Is flex mint: ${isFlex}, mint amount: ${mintAmount}`
    );

    if (isFlex && mezcalToMint.price) {
      logindex(
        `(processMint) Flex mint detected, calculating mint amount based on price terms`
      );
      const priceTerms = mezcalToMint.price[0];
      const payTo = priceTerms.pay_to;
      const priceAmount = priceTerms.amount;
      logindex(`(processMint) Pay to: ${payTo}, Price amount: ${priceAmount}`);
      if (!payTo) throw new Error("Missing pay_to address in price terms");
      if (!priceAmount || BigInt(priceAmount) === 0n)
        throw new Error("Invalid price amount");

      const totalRecv = Transaction.vout
        .filter((v) => v.scriptPubKey?.address === payTo)
        .map((v) => BigInt(Math.floor(v.value * 1e8)))
        .reduce((a, b) => a + b, 0n);
      logindex(
        `(processMint) Total received for pay_to address ${payTo}: ${totalRecv}`
      );

      mintAmount = totalRecv / BigInt(priceAmount);
      logindex(
        `(processMint) Calculated mint amount based on price terms: ${mintAmount}`
      );
    }

    logindex(`(processMint) Final mint amount to be minted: ${mintAmount}`);

    if (mintAmount <= 0n) {
      logindex(
        `(processMint) Mint amount is zero or negative, returning unallocated mezcals`
      );
      return UnallocatedMezcals;
    }

    logindex(
      `(processMint) finding from address for transaction ${Transaction.txid}`
    );

    let fromAddressResponse = findOne<IAddress>(
      "Address",
      Transaction.sender ?? "UNKNOWN",
      undefined,
      true
    );

    if (!isValidResponse<IAddress>(fromAddressResponse)) {
      logindex(
        `(processMint) From address not found in local cache for transaction ${Transaction.txid}, returning unallocated mezcals`
      );
      return UnallocatedMezcals;
    }
    logindex(
      `(processMint) From address found: ${safeStringify(fromAddressResponse)}`
    );
    //Emit MINT event on block
    create("Event", {
      type: 1,
      block,
      transaction_id: Transaction.virtual_id,
      mezcal_id: mezcalToMint.id,
      amount: mezcalToMint.mint_amount,
      from_address_id: fromAddressResponse.id,
      to_address_id: 2,
    });

    let newMints = (BigInt(mezcalToMint.mints) + BigInt(1)).toString();
    logindex(
      `(processMint) Updating mints for mezcal ${mezcalToMint.id} to ${newMints}`
    );
    updateAttribute(
      "Mezcal",
      mezcalToMint.mezcal_protocol_id,
      "mints",
      newMints
    );

    updateAttribute(
      "Mezcal",
      mezcalToMint.mezcal_protocol_id,
      "total_supply",
      (BigInt(mezcalToMint.total_supply) + mintAmount).toString()
    );
    logindex(
      `(processMint) Updated total supply for mezcal ${mezcalToMint.id} to ${
        BigInt(mezcalToMint.total_supply) + mintAmount
      }`
    );

    let newUnallocated = updateUnallocated(UnallocatedMezcals, {
      mezcal_id: mezcalToMint.mezcal_protocol_id,
      amount: BigInt(mintAmount),
    });

    logindex(
      `(processMint) New unallocated mezcals after mint: ${safeStringify(
        newUnallocated
      )}`
    );

    return newUnallocated;
  } else {
    logindex(
      `(processMint) Mint is closed for mezcal ${mezcalToMint.id}, returning unallocated mezcals`
    );
    //Minting is closed
    return UnallocatedMezcals;
  }
};

const processEtching = (
  UnallocatedMezcals: IUnallocatedMezcals,
  Transaction: IndexedTxExtended,
  rpc: RpcClient,
  storage: Storage,
  isGenesis: boolean,
  useTest: boolean
) => {
  const { logindex } = getIndexerLogger(storage, Transaction.txid);
  const { block, txIndex, mezcalstone } = Transaction;

  const etching = mezcalstone?.etching;

  const { findOne, create, local, findOrCreate } = storage;

  logindex(
    `(processEtching) Processing etching for transaction ${Transaction.txid} at block ${block} and txIndex ${txIndex}`
  );

  logindex(`(processEtching) Mezcalstone: ${safeStringify(mezcalstone)}`);

  //If no etching, return the input allocations
  if (!etching) {
    logindex(
      `(processEtching) No etching found in mezcalstone, returning unallocated mezcals`
    );
    return UnallocatedMezcals;
  }

  logindex(`(processEtching) Finding mezcal with id ${block}:${txIndex}`);

  let searchMezcal = findOne<IMezcal>(
    "Mezcal",
    `${block}:${txIndex}`,
    undefined,
    true
  );

  if (isValidResponse<IMezcal>(searchMezcal) || searchMezcal) {
    logindex(
      `(processEtching) Mezcal with id ${block}:${txIndex} already exists, returning unallocated mezcals`
    );
    //If the mezcal is not in the unallocated mezcals, it is ignored
    return UnallocatedMezcals;
  }

  //If mezcal name already taken, it is non standard, return the input allocations

  //Cenotaphs dont have any other etching properties other than their name
  //If not a cenotaph, check if a mezcal name was provided, and if not, generate one

  let mezcalName = etching.mezcal;

  logindex(
    `(processEtching) Mezcal name from etching: ${safeStringify(mezcalName)}`
  );

  const isMezcalNameTakenResponse = findOne<IMezcal>(
    "Mezcal",
    mezcalName + "@REF@name",
    undefined,
    true
  );

  logindex(
    `(processEtching) Checking if mezcal name ${mezcalName} is already taken: ${safeStringify(
      isMezcalNameTakenResponse
    )}`
  );

  if (
    isValidResponse<IMezcal>(isMezcalNameTakenResponse) ||
    !!isMezcalNameTakenResponse
  ) {
    logindex(
      `(processEtching) Mezcal name ${mezcalName} is already taken, returning unallocated mezcals`
    );

    return UnallocatedMezcals;
  }

  let isFlex =
    etching?.terms?.amount == 0n && etching?.terms?.price?.[0]?.pay_to.length;
  let hasMintcap = !!etching?.terms?.cap && etching?.terms?.cap !== 0n;

  logindex(
    `(processEtching) Is flex mode: ${isFlex}, Has mint cap: ${hasMintcap}`
  );

  if (!isFlex && etching?.terms?.amount == 0n) {
    logindex(
      `(processEtching) Etching is not in flex mode but amount is zero, returning unallocated mezcals`
    );
    //An etch attempting to use "flex mode" for mint that doesnt provide amount is invalid
    return UnallocatedMezcals;
  }

  if (isFlex && hasMintcap) {
    logindex(
      `(processEtching) Etching is in flex mode but has a mint cap, returning unallocated mezcals`
    );
    //An etch attempting to use "flex mode" for mint that provides a mint cap is invalid
    return UnallocatedMezcals;
  }

  if (isFlex && etching?.terms?.price?.length !== 1) {
    logindex(
      `(processEtching) Etching is in flex mode but has multiple price, returning unallocated mezcals`
    );
    //An etch attempting to use "flex mode" for mint that provides multiple price is invalid
    return UnallocatedMezcals;
  }

  /*
    Mezcalspec: Mezcals etched in a transaction with a cenotaph are set as unmintable.

    If the mezcalstone decoded has the cenotaph flag set to true, the mezcal should be created with no allocationg created

    see unminable flag in mezcal model
  */

  //FAILS AT 842255:596 111d77cbcb1ee54e0392de588cb7ef794c4a0a382155814e322d93535abc9c66)
  //This is a weird bug in the WASM implementation of the decoder where a "char" that might be valid in rust is shown as 0 bytes in JS.
  //Even weirder - sequelize rejects this upsert saying its "too long"
  const isSafeChar = Number(
    "0x" + Buffer.from(etching.symbol ?? "").toString("hex")
  );

  logindex(
    `(processEtching) Is safe char for symbol: ${isSafeChar}, Symbol: ${etching.symbol}`
  );

  const symbol = etching.symbol && isSafeChar ? etching.symbol : "¤";

  logindex(
    `(processEtching) Final symbol for mezcal: ${symbol} (isSafeChar: ${isSafeChar})`
  );

  const etcherId = findOrCreate<IAddress>(
    "Address",
    Transaction.sender ?? "UNKNOWN",
    { address: Transaction.sender, block: Transaction.block },
    true
  ).id;

  logindex(
    `(processEtching) Etcher address ID: ${etcherId} for transaction ${Transaction.txid}`
  );

  const EtchedMezcal = create<IMezcal>("Mezcal", {
    mezcal_protocol_id: !isGenesis ? `${block}:${txIndex}` : "1:0",
    name: mezcalName,
    symbol,
    block,
    //ORD describes no decimals being set as default 0
    decimals: etching.divisibility ?? 0,

    total_supply: etching.premine ?? "0",
    total_holders: 0, //This is updated on transfer edict
    mints: "0",
    premine: etching.premine ?? "0",

    /*

            ORD chooses the greater of the two values for mint start (height, offset)
            and the lesser of two values for mint_end (height, offset)

            See: https://github.com/ordinals/ord/blob/master/src/index/entry.rs LINE 112-146

            This is implemented in isMintOpen function
        */

    mint_cap: etching.terms?.cap ?? null, // null for no cap, otherwise the cap
    mint_amount: etching.terms?.amount ?? null,
    mint_start: etching.terms?.height?.[0] ?? null,
    mint_end: etching.terms?.height?.[1] ?? null,
    mint_offset_start: etching.terms?.offset?.[0] ?? null,
    mint_offset_end: etching.terms?.offset?.[1] ?? null,
    price: etching.terms?.price ?? null,
    turbo: etching.turbo,
    burnt_amount: "0",
    //Unmintable is a flag internal to this indexer, and is set specifically for cenotaphs as per the mezcal spec (see above)
    unmintable:
      mezcalstone.cenotaph || (!etching.terms?.amount && !isFlex) ? 1 : 0,
    etch_transaction_id: Transaction.virtual_id,
    deployer_address_id: etcherId,
  });

  logindex(
    `(processEtching) Etched mezcal created: ${safeStringify(EtchedMezcal)}`
  );

  //Emit Etch event on block
  create("Event", {
    type: 0,
    block,
    transaction_id: Transaction.virtual_id,
    mezcal_id: EtchedMezcal.id,
    amount: etching.premine ?? "0",
    from_address_id: etcherId,
    to_address_id: 2,
  });

  //Add premine mezcals to input allocations

  if (mezcalstone.cenotaph) {
    logindex(
      `(processEtching) Transaction is a cenotaph, burning all unallocated mezcals`
    );
    //No mezcals are premined if the tx is a cenotaph.
    return UnallocatedMezcals;
  }

  let newUnallocated = updateUnallocated(UnallocatedMezcals, {
    mezcal_id: EtchedMezcal.mezcal_protocol_id,
    amount: BigInt(EtchedMezcal.premine),
  });

  logindex(
    `(processEtching) Updated unallocated mezcals after etching: ${safeStringify(
      newUnallocated
    )}`
  );

  return newUnallocated;
};

const emitTransferAndBurnEvents = (
  transfers: ITransfers,
  Transaction: IndexedTxExtended,
  storage: Storage
) => {
  const { logindex } = getIndexerLogger(storage, Transaction.txid);
  const { create, findOrCreate, findOne } = storage;

  logindex(
    `(emitTransferAndBurnEvents) Emitting transfer and burn events for transaction ${Transaction.txid}`
  );
  Object.keys(transfers).forEach((addressId) => {
    logindex(
      `(emitTransferAndBurnEvents) Processing transfers for address ${addressId}: ${safeStringify(
        transfers[addressId]
      )}`
    );
    Object.keys(transfers[addressId]).forEach((mezcal_protocol_id) => {
      logindex(
        `(emitTransferAndBurnEvents) Processing transfer for mezcal ${mezcal_protocol_id} to address ${addressId}`
      );
      let amount = transfers[addressId][mezcal_protocol_id];
      if (!amount) {
        logindex(
          `(emitTransferAndBurnEvents) Amount for mezcal ${mezcal_protocol_id} to address ${addressId} is zero, skipping`
        );
        return; //Ignore 0 balances
      } //Ignore 0 balances

      logindex(
        `(emitTransferAndBurnEvents) Amount for mezcal ${mezcal_protocol_id} to address ${addressId}: ${amount}`
      );
      let foundMezcalResponse = findOne<IMezcal>(
        "Mezcal",
        mezcal_protocol_id,
        undefined,
        true
      );
      if (!isValidResponse<IMezcal>(foundMezcalResponse)) {
        logindex(
          `(emitTransferAndBurnEvents) Mezcal with id ${mezcal_protocol_id} not found in local cache, throwing error`
        );
        throw new Error(
          "Invalid response from local cache @ emitTransferAndBurnEvents:1"
        );
      }
      logindex(
        `(emitTransferAndBurnEvents) Found mezcal: ${safeStringify(
          foundMezcalResponse
        )}`
      );
      create("Event", {
        type: addressId === "burn" ? 3 : 2,
        block: Transaction.block,
        transaction_id: Transaction.virtual_id,
        mezcal_id: foundMezcalResponse.id,
        amount,
        from_address_id: findOrCreate(
          "Address",
          Transaction.sender ?? "UNKNOWN",
          { address: Transaction.sender, block: Transaction.block },
          true
        ).id,
        to_address_id: addressId === "burn" ? 2 : addressId,
      });
    });
  });

  return;
};

const finalizeTransfers = (
  inputUtxos: IndexerUtxo[],
  pendingUtxos: IPendingUtxos,
  Transaction: IndexedTxExtended,
  transfers: ITransfers,
  storage: Storage
) => {
  const { logindex } = getIndexerLogger(storage, Transaction.txid);
  const { updateAttribute, create, local, findOne } = storage;
  const { block, mezcalstone } = Transaction;
  logindex(
    `(finalizeTransfers) Finalizing transfers for transaction ${Transaction.txid} at block ${block}`
  );
  logindex(`(finalizeTransfers) Input UTXOs: ${safeStringify(inputUtxos)}`);
  logindex(`(finalizeTransfers) Pending UTXOs: ${safeStringify(pendingUtxos)}`);
  logindex(`(finalizeTransfers) Transfers: ${safeStringify(transfers)}`);
  emitTransferAndBurnEvents(transfers, Transaction, storage);

  let opReturnOutput = pendingUtxos.find((utxo) => utxo.address_id === 2);

  //Burn all mezcals from cenotaphs or OP_RETURN outputs (if no cenotaph is present)
  if (mezcalstone.cenotaph) {
    logindex(
      `(finalizeTransfers) Transaction is a cenotaph, burning all mezcals from input UTXOs`
    );
    inputUtxos.forEach((utxo) => burnAllFromUtxo(utxo, storage));
  } else if (opReturnOutput) {
    logindex(
      `(finalizeTransfers) Burning all mezcals from OP_RETURN output: ${safeStringify(
        opReturnOutput
      )}`
    );
    burnAllFromUtxo(opReturnOutput, storage);
  }

  //Update all input UTXOs as spent
  inputUtxos.forEach((utxo) => {
    logindex(
      `(finalizeTransfers) Updating input UTXO ${utxo.utxo_index} as spent in block ${block}`
    );
    logindex(`(finalizeTransfers) Input UTXO details: ${safeStringify(utxo)}`);
    logindex(`(finalizeTransfers) Transaction: ${safeStringify(Transaction)}`);
    updateAttribute("Utxo", utxo.utxo_index, "block_spent", block);
    updateAttribute(
      "Utxo",
      utxo.utxo_index,
      "transaction_spent_id",
      Transaction.virtual_id
    );
  });
  //Filter out all OP_RETURN and zero mezcal balances. This also removes UTXOS that were in a cenotaph because they will have a balance of 0
  //We still save utxos incase we need to reference them in the future
  //Filter out all OP_RETURN and zero mezcal balances

  logindex(
    `(finalizeTransfers) Filtering pending UTXOs to remove OP_RETURN and zero mezcal balances`
  );
  pendingUtxos = pendingUtxos.filter(
    (utxo) =>
      utxo.address_id !== 2 &&
      Object.values(utxo.mezcal_balances ?? {}).reduce(
        (a, b) => a + BigInt(b),
        0n
      ) > 0n
  );

  logindex(
    `(finalizeTransfers) Filtered pending UTXOs: ${safeStringify(pendingUtxos)}`
  );

  //Create all new UTXOs and create a map of their ids (remove all OP_RETURN too as they are burnt). Ignore on cenotaphs
  pendingUtxos.forEach((utxo) => {
    logindex(
      `(finalizeTransfers) Creating new UTXO for pending UTXO: ${safeStringify(
        utxo
      )}`
    );
    if (utxo.address_id !== 2) {
      logindex(
        `(finalizeTransfers) Creating UTXO for address_id ${
          utxo.address_id
        } with mezcal balances: ${safeStringify(utxo.mezcal_balances)}`
      );
      let resultUtxo = { ...utxo };
      delete resultUtxo.mezcal_balances;

      const parentUtxo = create<IUtxo>(
        "Utxo",
        resultUtxo as Omit<IndexerUtxo, "mezcal_balances">
      );

      let mezcalBalances = utxo.mezcal_balances;
      if (!mezcalBalances) {
        logindex(
          `(finalizeTransfers) No mezcal balances found for UTXO ${utxo.utxo_index}, skipping mezcal balance creation`
        );
        return;
      }

      Object.keys(mezcalBalances).forEach((mezcalProtocolId) => {
        logindex(
          `(finalizeTransfers) Creating UTXO balance for mezcal ${mezcalProtocolId} with balance ${mezcalBalances[mezcalProtocolId]}`
        );
        if (!mezcalBalances[mezcalProtocolId]) return; //Ignore 0 balances

        logindex(
          `(finalizeTransfers) Finding mezcal with protocol id ${mezcalProtocolId}`
        );
        let findMezcalResponse = findOne<IMezcal>(
          "Mezcal",
          mezcalProtocolId,
          undefined,
          true
        );

        if (!isValidResponse<IMezcal>(findMezcalResponse)) {
          logindex(
            `(finalizeTransfers) Mezcal with id ${mezcalProtocolId} not found in local cache, throwing error`
          );
          return;
        }

        create("Utxo_balance", {
          utxo_id: parentUtxo.id,
          mezcal_id: findMezcalResponse.id,
          balance: mezcalBalances[mezcalProtocolId],
        });
      });
    }
  });

  //Create a vec of all UTXOs and their direction (1 for adding to balance, -1 for subtracting from balance)
  const allUtxos = [
    //Input utxos are spent, so they should be subtracted from balance
    ...inputUtxos.map((utxo) => [utxo, -1]),
    //New utxos are added to balance (empty array if cenotaph because of the filter above)
    ...pendingUtxos.map((utxo) => [utxo, 1]),
  ] as [IndexerUtxo, 1 | -1][];

  logindex(
    `(finalizeTransfers) All UTXOs to update balances: ${safeStringify(
      allUtxos
    )}`
  );

  //Finally update balance store with new Utxos (we can call these at the same time because they are updated in memory, not on db)

  allUtxos.map(([utxo, direction]) => {
    logindex(
      `(finalizeTransfers) Updating balances for UTXO ${utxo.utxo_index} with direction ${direction}`
    );
    return updateOrCreateBalancesWithUtxo(
      utxo,
      storage,
      direction,
      Transaction
    );
  });

  return;
};

const handleGenesis = (
  Transaction: IndexedTxExtended,
  rpc: RpcClient,
  storage: Storage
) => {
  const { logindex } = getIndexerLogger(storage, Transaction.txid);
  logindex(
    `(handleGenesis) Handling genesis transaction for ${Transaction.txid}`
  );
  processEtching(
    {},
    { ...Transaction, mezcalstone: GENESIS_MEZCALTONE },
    rpc,
    storage,
    true,
    false
  );
  return;
};

const processMezcalstone = (
  Transaction: IndexedTxExtended,
  rpc: RpcClient,
  storage: Storage,
  useTest: boolean
) => {
  const { vout, vin, block, hash } = Transaction;
  if (block < GENESIS_BLOCK) {
    return; //not valid until genesis block
  }

  const { create, fetchGroupLocally, findOne, local, findOrCreate } = storage;

  //Ignore the coinbase transaction (unless genesis mezcal is being created)

  //Setup Transaction for processing

  //If the utxo is not in db it was made before GENESIS (840,000) anmd therefore does not contain mezcals

  //We also filter for utxos already sppent (this will never happen on mainnet, but on regtest someone can attempt to spend a utxo already marked as spent in the db)

  //Ignore coinbase tx if not genesis since it has no input utxos

  startTimer();

  let UtxoFilter = vin
    .filter((vin) => !vin.coinbase)
    .map((vin) => {
      let transactionFound = findOne<ITransaction>(
        "Transaction",
        vin.txid,
        undefined,
        true
      );
      if (!isValidResponse<ITransaction>(transactionFound)) {
        return `-1:${vin.vout}`;
      }
      return `${transactionFound.id ?? "-1"}:${vin.vout}`;
    });

  stopTimer("body_init_filter_generator");

  let inputUtxos = UtxoFilter.map((utxoIndex) => {
    const utxo = findOne<IUtxo>("Utxo", utxoIndex, undefined, true);

    if (!isValidResponse<IUtxo>(utxo)) {
      return null;
    }
    const balances = fetchGroupLocally("Utxo_balance", "utxo_id", utxo.id);

    return {
      ...utxo,
      utxo_index: utxoIndex,
      address_id: Number(utxo.address_id),
      transaction_id: Number(utxo.transaction_id),
      mezcal_balances: balances.reduce((acc, utxoBalance) => {
        let mezcalResponse = findOne<IMezcal>(
          "Mezcal",
          utxoBalance.mezcal_id + "@REF@id",
          undefined,
          true
        );

        if (!isValidResponse<IMezcal>(mezcalResponse)) {
          return acc;
        }

        acc[mezcalResponse.mezcal_protocol_id] = utxoBalance.balance;
        return acc;
      }, {} as Record<string, bigint>),
    };
  }).filter(Boolean) as IndexerUtxo[];

  stopTimer("body_init_utxo_fetch");

  //
  if (
    //If no input utxos are provided (with mezcals inside)
    inputUtxos.length === 0 &&
    //AND there is no mezcalstone field in the transaction (aside from cenotaph)
    Object.keys(Transaction.mezcalstone).length === 1
  ) {
    //We can return as this transaction will not mint or create new utxos. This saves storage for unrelated transactions
    if (!(vin[0].coinbase && block == GENESIS_BLOCK)) return;
  }

  const parentTransaction = create<ITransaction>("Transaction", {
    hash,
    block,
  });

  const { logindex } = getIndexerLogger(storage, hash);
  logindex(
    `(processMezcalstone) Processing transaction ${hash} at block ${block}`
  );
  logindex(
    `(processMezcalstone) Full transaction: ${safeStringify(Transaction)}`
  );

  Transaction.virtual_id = Number(parentTransaction.id);

  let addressFound = findOne<IAddress>(
    "Address",
    inputUtxos[0]?.address_id + "@REF@id",
    undefined,
    true
  );

  logindex(
    `(processMezcalstone) Found address for transaction ${hash}: ${safeStringify(
      addressFound
    )}`
  );

  if (!isValidResponse<IAddress>(addressFound)) {
    logindex(
      `(processMezcalstone) Address not found for transaction ${hash}, setting address to UNKNOWN`
    );
    addressFound = { address: "UNKNOWN" } as IAddress;
  }

  Transaction.sender =
    //check if it was populated in
    Transaction.sender ??
    //if it wasnt populated in check if its in db froma prev utxo
    addressFound.address;

  logindex(
    `(processMezcalstone) Transaction sender: ${Transaction.sender} for transaction ${hash}`
  );

  if (vin[0].coinbase && block === GENESIS_BLOCK) {
    logindex(
      `(processMezcalstone) Transaction is a coinbase transaction at genesis block, handling genesis`
    );
    handleGenesis(Transaction, rpc, storage);
  }

  startTimer();
  logindex(
    `(processMezcalstone) Creating pending UTXOs for transaction ${hash}`
  );
  let pendingUtxos = createNewUtxoBodies(vout, Transaction, storage);

  logindex(
    `(processMezcalstone) Created pending UTXOs: ${safeStringify(pendingUtxos)}`
  );

  let UnallocatedMezcals = getUnallocatedMezcalsFromUtxos(inputUtxos);

  /*
  Create clone of Unallocated Mezcals, this will be used when emitting the "Transfer" event. If the Mezcal was present in the original
  mezcals from vin we have the address indexed on db and can emit the transfer event with the "From" equalling the address of transaction signer.
  However, if the Mezcal was not present in the original mezcals from vin, we can only emit the "From" as "UNALLOCATED" since we dont have the address indexed
  and the mezcals in the final Unallocated Mezcals Buffer came from the etching or minting process and were created in the transaction.
  */

  //let MappedTransactions = await getParentTransactionsMapFromUtxos(UtxoFilter, db)

  //Delete UTXOs as they are being spent
  // => This should be processed at the end of the block, with filters concatenated.. await Utxo.deleteMany({hash: {$in: UtxoFilter}})

  //Reference of UnallocatedMezcals and pendingUtxos is passed around in follwoing functions
  //Process etching is potentially asyncrhnous because of commitment checks
  stopTimer("body_init_pending_utxo_creation");

  startTimer();
  logindex(
    `(processMezcalstone) Processing etching for transaction ${hash} with UnallocatedMezcals: ${safeStringify(
      UnallocatedMezcals
    )}`
  );

  processEtching(UnallocatedMezcals, Transaction, rpc, storage, false, useTest);
  stopTimer("etch");

  //Mints are processed next and added to the MezcalAllocations, with caps being updated (and burnt in case of cenotaphs)

  startTimer();

  logindex(
    `(processMezcalstone) Processing mint for transaction ${hash} with UnallocatedMezcals: ${safeStringify(
      UnallocatedMezcals
    )}`
  );

  processMint(UnallocatedMezcals, Transaction, storage);
  stopTimer("mint");

  //Allocate all transfers from unallocated payload to the pendingUtxos
  startTimer();

  let transfers = {};

  logindex(
    `(processMezcalstone) Processing transfers for transaction ${hash} with UnallocatedMezcals: ${safeStringify(
      UnallocatedMezcals
    )}`
  );
  logindex(
    `(processMezcalstone) Pending UTXOs before processing transfers: ${safeStringify(
      pendingUtxos
    )}, transfers: ${safeStringify(transfers)}`
  );

  processEdicts(
    UnallocatedMezcals,
    pendingUtxos,
    Transaction,
    transfers,
    storage
  );
  stopTimer("edicts");

  //Commit the utxos to storage and update Balances
  logindex(
    `(processMezcalstone) Finalizing transfers for transaction ${hash} with UnallocatedMezcals: ${safeStringify(
      UnallocatedMezcals
    )}, pendingUtxos: ${safeStringify(
      pendingUtxos
    )}, transfers: ${safeStringify(transfers)}`
  );
  startTimer();
  finalizeTransfers(inputUtxos, pendingUtxos, Transaction, transfers, storage);

  logindex(`(processMezcalstone) Finalized transfers for transaction ${hash}`);
  logindex(
    `(processMezcalstone) Finished processing transaction ${hash} at block ${block}`
  );

  stopTimer("transfers");
  return;
};

const loadBlockIntoMemory = async (
  block: IndexedTxExtended[],
  storage: Storage
) => {
  /*
  Necessary indexes for building (the rest can be built afterwards)

  Transaction -> hash
  Utxo -> ( transaction_id, vout_index )
  Address -> address
  Mezcal -> mezcal_protocol_id, raw_name
    Balance -> address_id
  */

  //Events do not need to be loaded as they are purely write and unique

  if (!Array.isArray(block)) {
    throw "Non array block passed to loadBlockIntoMemory";
  }

  const { loadManyIntoMemory, local, findOne } = storage;

  //Load all utxos in the block's vin into memory in one call

  startTimer();

  let currBlock = block;
  const transactionHashInputsInBlock = [
    ...new Set(
      block
        .map((transaction: Transaction) =>
          transaction.vin.map((utxo) => utxo.txid)
        )
        .flat(10)
        .filter(Boolean)
    ),
  ];

  await loadManyIntoMemory("Transaction", {
    hash: {
      [Op.in]: transactionHashInputsInBlock,
    },
  });
  stopTimer("load_transaction_hash");

  startTimer();

  //Get a vector of all txHashes in the block
  const utxosInBlock = [
    ...new Set(
      block
        .map((transaction) =>
          transaction.vin.map((utxo) => {
            if (!utxo.txid) {
              return null;
            }

            let foundTransaction = findOne<ITransaction>(
              "Transaction",
              utxo.txid,
              undefined,
              true
            );

            //coinbase txs dont have a vin
            if (utxo.vout === undefined) {
              return null;
            }

            return isValidResponse(foundTransaction)
              ? {
                  transaction_id: Number(foundTransaction.id),
                  vout_index: utxo.vout,
                }
              : null;
          })
        )
        .flat(10)
        .filter(Boolean) as { transaction_id: number; vout_index: number }[]
    ),
  ];

  await loadManyIntoMemory("Utxo", {
    [Op.and]: [
      {
        [Op.or]: utxosInBlock.map(({ transaction_id, vout_index }) => ({
          transaction_id,
          vout_index,
        })),
      },
      {
        block_spent: {
          [Op.is]: null,
        },
      },
    ],
  });
  stopTimer("load_utxos");

  startTimer();
  const utxoBalancesInBlock = [
    ...new Set(Object.values(local.Utxo).map((utxo) => utxo.id)),
  ];

  await loadManyIntoMemory("Utxo_balance", {
    utxo_id: {
      [Op.in]: utxoBalancesInBlock,
    },
  });

  stopTimer("load_utxo_balances");

  startTimer();

  const utxoBalancesInLocal = local.Utxo_balance;

  //Get a vector of all recipients in the block utxo.scriptPubKey?.address
  const recipientsInBlock = [
    ...new Set(
      block
        .map((transaction) =>
          transaction.vout
            .map((utxo) => utxo.scriptPubKey?.address)
            .filter(Boolean)
        )
        .flat(Infinity)
    ),
  ];

  /*
{
        address: {
          [Op.in]: recipientsInBlock,
        },
      },
*/

  await loadManyIntoMemory("Address", {
    id: {
      [Op.in]: [
        1,
        2,
        3,
        ...Object.values(local.Utxo).map((utxo) => utxo.address_id),
      ],
    },
  });

  await loadManyIntoMemory("Address", {
    address: {
      [Op.in]: recipientsInBlock,
    },
  });

  //load senders
  await loadManyIntoMemory("Address", {
    address: {
      [Op.in]: block.map((transaction) => transaction.sender).filter(Boolean),
    },
  });

  stopTimer("load_addresses");

  startTimer();

  //Get all mezcal id in all edicts, mints and utxos (we dont need to get etchings as they are created in memory in the block)
  const mezcalsInBlockByProtocolId = [
    ...new Set(
      [
        //Get all mezcal ids in edicts and mints

        block.map((transaction) => [
          transaction.mezcalstone.mint,
          transaction.mezcalstone.edicts?.map((edict) => edict.id),
        ]),
      ]
        .flat(10)
        //0:0 refers to self, not an actual mezcal
        .filter((mezcal) => mezcal !== "0:0")
    ),
  ];

  const mezcalsInBlockByDbId = [
    ...new Set(
      //Get all mezcal ids in all utxos balance
      Object.values(utxoBalancesInLocal).map((utxo) => utxo.mezcal_id)
    ),
  ];

  const mezcalsInBlockByRawName = [
    ...new Set(
      block.map((transaction) => transaction.mezcalstone.etching?.mezcal)
    ),
  ]
    .flat(Infinity)
    //0:0 refers to self, not an actual mezcal
    .filter((mezcal) => mezcal);

  //Load all mezcals that might be transferred into memory. This would be every Mezcal in a mint, edict or etch

  // Load mezcals by protocol ID
  await loadManyIntoMemory("Mezcal", {
    mezcal_protocol_id: {
      [Op.in]: mezcalsInBlockByProtocolId,
    },
  });

  // Load mezcals by raw name
  await loadManyIntoMemory("Mezcal", {
    name: {
      [Op.in]: mezcalsInBlockByRawName,
    },
  });

  // Load mezcals by database ID
  await loadManyIntoMemory("Mezcal", {
    id: {
      [Op.in]: mezcalsInBlockByDbId,
    },
  });
  stopTimer("load_mezcals");

  startTimer();
  const balancesInBlock = [
    ...new Set(
      Object.values(local.Address)
        .map((address) => address.id)
        .filter(Boolean)
    ),
  ];

  //Load the balances of all addresses owning a utxo or in a transactions vout
  await loadManyIntoMemory("Balance", {
    address_id: {
      [Op.in]: balancesInBlock,
    },
  });

  stopTimer("load_balances");
  log(
    "loaded: " + Object.keys(local.Address).length + "  adresses into memory.",
    "debug"
  );

  log(
    "loaded: " + Object.keys(local.Transaction).length + "  txs into memory",
    "debug"
  );

  log(
    "loaded: " + Object.keys(local.Utxo).length + "  utxos into memory",
    "debug"
  );

  log(
    "loaded: " + Object.keys(local.Balance).length + "  balances into memory",
    "debug"
  );
  log(
    "loaded: " +
      Object.keys(local.Utxo_balance).length +
      "  balances into memory",
    "debug"
  );
  log(
    "loaded: " + Object.keys(local.Mezcal).length + "  mezcals into memory",
    "debug"
  );

  Object.keys(__debug_totalElapsedTime).forEach((field) => {
    log(
      `Time spent on ${field}: ${__debug_totalElapsedTime[field]}ms`,
      "debug"
    );
  });

  __debug_totalElapsedTime = {};

  return;
};

const processBlock = (
  block: { blockHeight: number; blockData: IndexedTxExtended[] },
  callRpc: RpcClient,
  storage: Storage,
  useTest: boolean
) => {
  const { blockHeight, blockData } = block;

  const formatMemoryUsage = (data: number) =>
    `${Math.round((data / 1024 / 1024) * 100) / 100} MB`;

  const memoryData = process.memoryUsage();

  for (const [key, value] of Object.entries(memoryData)) {
    log(`${key}: ${formatMemoryUsage(value)}`, "debug");
  }
  //await sleep(2000);
  log(
    "Processing " + blockData.length + " transactions for block " + blockHeight
  );
  for (let TransactionIndex in blockData) {
    let Transaction = blockData[TransactionIndex];

    try {
      //REMOVE THIS! This is for the --test flag
      if (useTest) Transaction.block = blockHeight;

      processMezcalstone(Transaction, callRpc, storage, useTest);
    } catch (e) {
      log(
        "Indexer panic on the following transaction: " +
          "\nhash: " +
          Transaction.hash +
          "\nblock: " +
          blockHeight +
          "\nindex: " +
          TransactionIndex +
          "/" +
          blockData.length +
          "\nmezcalstone: " +
          JSON.stringify(Transaction.mezcalstone, (_, v) =>
            typeof v === "bigint" ? v.toString() : v
          ) +
          "\ntransaction: " +
          JSON.stringify(Transaction, (_, v) =>
            typeof v === "bigint" ? v.toString() : v
          ),
        "panic"
      );
      throw e;
    }
  }

  Object.keys(__debug_totalElapsedTime).forEach((field) => {
    log(
      `Time spent on ${field}: ${__debug_totalElapsedTime[field]}ms`,
      "debug"
    );
  });

  __debug_totalElapsedTime = {};

  return;
};

export { processBlock, loadBlockIntoMemory };
