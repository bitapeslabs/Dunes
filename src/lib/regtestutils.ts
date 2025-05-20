import { Block, Transaction } from "@/lib/apis/bitcoinrpc";
import { createRpcClient } from "@/lib/apis/bitcoinrpc";
import { IEsploraTransaction } from "@/lib/apis/esplora/types";
import { BTC_RPC_URL, BTC_RPC_USERNAME, BTC_RPC_PASSWORD } from "@/lib/consts";
import { processBlock } from "@/lib/indexer";
import { getMezcalstonesFromBlock } from "@/lib/mezcalutils";
import { storage as newStorage } from "@/lib/storage";
import { IStorage } from "@/lib/storage";
import { IJoinedEvent } from "@/rpc/mezcal/lib/cache";
import { IJoinedMezcal } from "@/rpc/mezcal/lib/queries";
import { populateResultsWithPrevoutData } from "@/lib/mezcalutils";
import { loadBlockIntoMemory } from "@/lib/indexer";
import { IMezcal } from "@/database/createConnection";
/* ------------------------------------------------------------------
 * 1.  Type Definitions
 * ---------------------------------------------------------------- */

export interface RawAddress {
  id: string | number;
  address: string;
}

export interface RawTransaction {
  id: string | number;
  hash: string;
}

export interface RawEvent {
  id: string | number;
  type: number; // 0 = Etch, 1 = Mint, 2 = Transfer, 3 = Burn
  block: number;
  transaction_id: string | number | null;
  mezcal_id: string | number | null;
  amount: string;
  from_address_id: string | number | null;
  to_address_id: string | number | null;
}

export interface RawDataShape {
  Address: Record<string, RawAddress>;
  Transaction: Record<string, RawTransaction>;
  Mezcal: Record<string, IMezcal>;
  Event: Record<string, RawEvent>;
}

export interface EventDto {
  id: string; // BIGINT mapped to string
  type: number;
  block: number;
  transaction: string | null; // tx hash
  mezcal: IJoinedMezcal | null;
  amount: string;
  from_address: string | null;
  to_address: string | null;
}

function buildLookup<T extends { id: string | number }, V>(
  items: T[],
  valueSelector: (item: T) => V
): Map<string, V> {
  const map = new Map<string, V>();
  for (const item of items) {
    map.set(String(item.id), valueSelector(item));
  }
  return map;
}

/* ------------------------------------------------------------------
 * 3.  Main Transformation Function
 * ---------------------------------------------------------------- */

export function denormalizeEvents(raw: RawDataShape): EventDto[] {
  /* ----------------------------------------------
   * 3.1 Prepare lookup maps (O(1) for every join)
   * --------------------------------------------*/
  const addressById = buildLookup(Object.values(raw.Address), (a) => a.address);
  const txHashById = buildLookup(Object.values(raw.Transaction), (t) => t.hash);
  const rawMezcalById = buildLookup(Object.values(raw.Mezcal), (m) => m);

  /** Create a second map that stores IJoinedMezcal (with joins already applied) */
  const joinedMezcalById = new Map<string, IJoinedMezcal>();

  for (const rawMezcal of Object.values(raw.Mezcal)) {
    const joined: IJoinedMezcal = {
      ...rawMezcal,
      etch_transaction: txHashById.get(String(rawMezcal.etch_transaction_id))!,

      deployer_address: addressById.get(String(rawMezcal.deployer_address_id))!,
    };
    joinedMezcalById.set(String(rawMezcal.id), joined);
  }

  /* ----------------------------------------------
   * 3.2 Convert raw events → EventDto[]
   * --------------------------------------------*/
  const eventDtos: EventDto[] = [];

  for (const rawEvent of Object.values(raw.Event)) {
    const eventDto: EventDto = {
      id: String(rawEvent.id),
      type: rawEvent.type,
      block: rawEvent.block,
      amount: rawEvent.amount,

      transaction:
        rawEvent.transaction_id !== null
          ? txHashById.get(String(rawEvent.transaction_id)) ?? null
          : null,

      mezcal:
        rawEvent.mezcal_id !== null
          ? joinedMezcalById.get(String(rawEvent.mezcal_id)) ?? null
          : null,

      from_address:
        rawEvent.from_address_id !== null
          ? addressById.get(String(rawEvent.from_address_id)) ?? null
          : null,

      to_address:
        rawEvent.to_address_id !== null
          ? addressById.get(String(rawEvent.to_address_id)) ?? null
          : null,
    };

    eventDtos.push(eventDto);
  }

  return eventDtos;
}

const esploraTxToRpcTx = (transaction: IEsploraTransaction): Transaction => {
  const { vin, vout, txid, size, version, locktime } = transaction;

  return {
    vin: vin,

    vout: vout.map((v, i) => ({
      ...v,
      n: i,
      scriptPubKey: {
        address: v.scriptpubkey_address,
        asm: v.scriptpubkey_asm,
        type: v.scriptpubkey_type,
        hex: v.scriptpubkey,
      },
    })),
    hash: txid,
    vsize: size,
    size,
    version,
    locktime,
    txid,
  };
};
export const regtestTransactionsIntoBlock = async (
  transactions: IEsploraTransaction[]
): Promise<EventDto[]> => {
  const storage = await newStorage();

  const rpcClient = createRpcClient({
    url: BTC_RPC_URL,
    username: BTC_RPC_USERNAME,
    password: BTC_RPC_PASSWORD,
  });

  const blockTip = Number(await rpcClient.callRpc("getblockcount"));

  const fakeBlock: Block = {
    hash: "000",
    confirmations: 1,
    size: 0,
    height: blockTip,
    version: 0,
    versionHex: "0x0",
    merkleroot: "0x0",
    tx: transactions.map(esploraTxToRpcTx),
    time: Date.now(),
    mediantime: Date.now(),
    nonce: 0,
    bits: "0x0",
    difficulty: 1,
    chainwork: "0x0",
    nTx: transactions.length,
    previousblockhash: "0x0",
    nextblockhash: "0x0",
  };

  const indexedTxs = getMezcalstonesFromBlock(fakeBlock);

  const [hydratedTxs] = await populateResultsWithPrevoutData(
    [indexedTxs],
    rpcClient.callRpc,
    storage
  );

  storage.local.Utxo = {};

  await loadBlockIntoMemory(hydratedTxs, storage);
  processBlock(
    { blockHeight: blockTip, blockData: hydratedTxs },
    rpcClient,
    storage,
    true
  );
  const events = denormalizeEvents(storage.local as unknown as RawDataShape);
  return events;
};

type IMezcalTransactionAsset = {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
};

export type IMezcalTransaction = {
  type: "ETCH" | "MINT" | "TRANSFER" | "BURN" | "AIRDROP";
  target: "incoming" | "outgoing";
  target_address: string;
  confirmed: boolean;
  asset: IMezcalTransactionAsset;
  amount: string;
  transaction_id: string;
  timestamp: number;
};

export function mapToMezcalTransactions(
  input: (Omit<EventDto, "type"> & {
    owner_address: string;
    type: "ETCH" | "MINT" | "TRANSFER" | "BURN" | "AIRDROP";
    tx: IEsploraTransaction;
  })[]
): IMezcalTransaction[] {
  return input.map((event, index): IMezcalTransaction => {
    let target: "incoming" | "outgoing" = "incoming";
    if (event.type === "TRANSFER") {
      target =
        event.owner_address === event.to_address ? "incoming" : "outgoing";
    }

    let target_address = String(
      target === "incoming" ? event.to_address : event.from_address
    );
    if (event.type === "ETCH" || event.type === "MINT") {
      target_address = "COINBASE";
    }

    return {
      type: event.type,
      confirmed: event.tx.status.confirmed,
      target,
      target_address,
      asset: {
        id: String(event.mezcal?.mezcal_protocol_id),
        name: String(event.mezcal?.name),
        symbol: String(event.mezcal?.symbol),
        decimals: Number(event.mezcal?.decimals),
      },
      amount: event.amount,
      transaction_id: event.tx.txid,
      timestamp: Number(event.tx.status.block_time ?? event.tx.locktime),
    };
  });
}
