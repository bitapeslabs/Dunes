import { Block, Transaction } from "@/lib/apis/bitcoinrpc";
import { createRpcClient } from "@/lib/apis/bitcoinrpc";
import { IEsploraTransaction } from "@/lib/apis/esplora/types";
import { BTC_RPC_URL, BTC_RPC_USERNAME, BTC_RPC_PASSWORD } from "@/lib/consts";
import { processBlock } from "@/lib/indexer";
import { getMezcalstonesFromBlock } from "@/lib/mezcalutils";
import { storage as newStorage } from "@/lib/storage";
import { IStorage } from "@/lib/storage";
import { IJoinedEvent } from "@/rpc/mezcal/lib/cache";
import { populateResultsWithPrevoutData } from "@/lib/mezcalutils";
import { loadBlockIntoMemory } from "@/lib/indexer";
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

export interface RawMezcal {
  id: string | number;
  mezcal_protocol_id: string;
  // ── other Mezcal-specific columns you already have ───────────────
  etch_transaction_id: string | number | null;
  deployer_address_id: string | number | null;
  // … (all the remaining fields from your Sequelize model)
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
  Mezcal: Record<string, RawMezcal>;
  Event: Record<string, RawEvent>;
}

/** High-level DTOs expected by your application */
export interface IMezcal extends RawMezcal {} // your Sequelize model
export interface IJoinedMezcal extends IMezcal {
  etch_transaction: string | null;
  deployer_address: string | null;
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
      etch_transaction:
        rawMezcal.etch_transaction_id !== null
          ? txHashById.get(String(rawMezcal.etch_transaction_id)) ?? null
          : null,
      deployer_address:
        rawMezcal.deployer_address_id !== null
          ? addressById.get(String(rawMezcal.deployer_address_id)) ?? null
          : null,
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
  const rpcClient = createRpcClient({
    url: BTC_RPC_URL,
    username: BTC_RPC_USERNAME,
    password: BTC_RPC_PASSWORD,
  });

  const storage = await newStorage();
  const fakeBlock: Block = {
    hash: "000",
    confirmations: 1,
    size: 0,
    height: 0,
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

  await loadBlockIntoMemory(hydratedTxs, storage);

  processBlock(
    { blockHeight: 0, blockData: hydratedTxs },
    rpcClient,
    storage,
    false
  );

  const events = denormalizeEvents(storage.local as unknown as RawDataShape);
  return events;
};
