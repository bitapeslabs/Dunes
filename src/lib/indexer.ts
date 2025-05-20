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
import { GENESIS_BLOCK, GENESIS_MEZCALTONE } from "./consts";
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

const coerceIntoValid = <T>(
  call: (...args: any) => T | null | Promise<unknown>
) => {
  let response = call();
  if (isValidResponse<T>(response)) {
    return response;
  } else {
    throw new Error("Invalid response from local cache");
  }
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

  return vout.map((out) => {
    const addressRow = findOrCreate<IAddress>(
      "Address",
      out.scriptPubKey.address ?? "OP_RETURN",
      { address: out.scriptPubKey.address ?? "OP_RETURN" },
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

  if (!utxo.mezcal_balances) {
    return;
  }

  Object.entries(utxo.mezcal_balances).forEach(([mezcalId, amt]) => {
    const mezcal = findOne<IMezcal>("Mezcal", mezcalId, undefined, true);

    if (!isValidResponse<IMezcal>(mezcal)) {
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
  direction: 1 | -1
): void => {
  const { findManyInFilter, create, updateAttribute, findOne } = storage;
  if (!utxo.mezcal_balances) {
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
    throw new Error("Invalid response from local cache");
  }

  const mezcalsMap = mezcalsMapResponse.reduce<Record<string, any>>(
    (a, d: any) => {
      a[d.mezcal_protocol_id] = d;
      a[d.id] = d;
      return a;
    },
    {}
  );

  const balanceFilter = entries.map(
    ([proto]) => `${utxo.address_id}:${mezcalsMap[proto].id}`
  );

  const existingBalancesResponse = findManyInFilter<IBalance>(
    "Balance",
    balanceFilter,
    true
  );

  if (!isValidResponse<IBalance[]>(existingBalancesResponse)) {
    throw new Error("Invalid response from local cache");
  }

  let existingBalances = existingBalancesResponse.reduce<Record<string, any>>(
    (acc, bal: any) => {
      acc[mezcalsMap[bal.mezcal_id].mezcal_protocol_id] = bal;
      return acc;
    },
    {}
  );

  for (const [proto, amt] of entries) {
    let bal = existingBalances[proto];

    if (!bal) {
      let mezcal = findOne<IMezcal>("Mezcal", proto, undefined, true);

      if (!isValidResponse<IMezcal>(mezcal)) {
        throw new Error("Invalid response from local cache");
      }

      let mezcalId = mezcal.id;

      bal = create("Balance", {
        mezcal_id: mezcalId,
        address_id: utxo.address_id,
        balance: 0,
      });
    }

    const newBalance = BigInt(bal.balance) + BigInt(amt) * BigInt(direction);

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
  const { block, txIndex, mezcalstone, vin } = Transaction;
  const { findManyInFilter, create, findOne, findOrCreate } = storage;

  let { edicts, pointer } = mezcalstone;

  if (mezcalstone.cenotaph) {
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

    if (!utxo.mezcal_balances) {
      utxo.mezcal_balances = {};
    }

    utxo.mezcal_balances[mezcalId] =
      (utxo.mezcal_balances[mezcalId] ?? 0n) + withDefault;

    //Dont save transfer events of amount "0"
    if (withDefault === 0n) return;

    let toAddress = utxo.address_id === 2 ? "burn" : utxo.address_id;

    if (!transfers[toAddress]) {
      transfers[toAddress] = {};
    }
    if (!transfers[toAddress][mezcalId]) {
      transfers[toAddress][mezcalId] = 0n;
    }

    transfers[toAddress][mezcalId] += withDefault;
  };

  //References are kept because filter does not clone the array
  let nonOpReturnOutputs = pendingUtxos.filter((utxo) => utxo.address_id !== 2);

  if (edicts) {
    const transactionMezcalId = `${block}:${txIndex}`;

    //Replace all references of 0:0 with the actual mezcal id which we have stored on db (Transferring#5)
    edicts.forEach(
      (edict) =>
        (edict.id = edict.id === "0:0" ? transactionMezcalId : edict.id)
    );

    //Get mezcal ids from edicts for filter below (the mezcal id is the PrimaryKey)
    let edictFilter = edicts.map((edict) => edict.id);

    //Cache all mezcals that are currently in DB in a hashmap, if a mezcal doesnt exist edict will be ignored

    //uses optimized lookup by using mezcal_protocol_id
    let existingMezcalsResponse = findManyInFilter<IMezcal>(
      "Mezcal",
      edictFilter,
      true
    );

    if (!isValidResponse<IMezcal[]>(existingMezcalsResponse)) {
      throw new Error("Invalid response from local cache @ processEdicts:1");
    }

    let existingMezcals = existingMezcalsResponse.reduce(
      (acc, mezcal) => ({ ...acc, [mezcal.mezcal_protocol_id]: mezcal }),
      {} as Record<string, IMezcal>
    );

    for (let edictIndex in edicts) {
      let edict = edicts[edictIndex];
      //A mezcalstone may contain any number of edicts, which are processed in sequence.
      if (!existingMezcals[edict.id]) {
        //If the mezcal does not exist, the edict is ignored
        continue;
      }

      if (!UnallocatedMezcals[edict.id]) {
        //If the mezcal is not in the unallocated mezcals, it is ignored
        continue;
      }

      if (edict.output === pendingUtxos.length) {
        //Edict amount is in string, not bigint
        if (edict.amount === 0n) {
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
            const amount = BigInt(UnallocatedMezcals[edict.id]) / amountOutputs;
            const remainder =
              BigInt(UnallocatedMezcals[edict.id]) % amountOutputs;

            const withRemainder = amount + BigInt(1);

            nonOpReturnOutputs.forEach((utxo, index) =>
              allocate(
                utxo,
                edict.id,
                index < remainder ? withRemainder : amount
              )
            );
          }
        } else {
          //If an edict would allocate more mezcals than are currently unallocated, the amount is reduced to the number of currently unallocated mezcals. In other words, the edict allocates all remaining unallocated units of mezcal id.

          nonOpReturnOutputs.forEach((utxo) =>
            allocate(utxo, edict.id, BigInt(edict.amount))
          );
        }
        continue;
      }

      //Transferring directly to op_return is allowed
      allocate(pendingUtxos[edict.output], edict.id, BigInt(edict.amount));
    }
  }

  //Transfer remaining mezcals to the first non-opreturn output
  //(edge case) If only an OP_RETURN output is present in the Transaction, transfer to the OP_RETURN

  let pointerOutput = pointer
    ? pendingUtxos[pointer] ?? nonOpReturnOutputs[0]
    : nonOpReturnOutputs[0];

  //pointerOutput should never be undefined since there is always either a non-opreturn or an op-return output in a transaction

  if (!pointerOutput) {
    //pointer is not provided and there are no non-OP_RETURN outputs
    let foundPendingUtxos = pendingUtxos.find((utxo) => utxo.address_id === 2);

    if (foundPendingUtxos) {
      pointerOutput = foundPendingUtxos;
    } else {
      throw new Error("No pointer output found. This transaction is invalid.");
    }
  }

  //move Unallocated mezcals to pointer output
  Object.entries(UnallocatedMezcals).forEach((allocationData) =>
    allocate(pointerOutput, allocationData[0], allocationData[1])
  );

  //Function returns the burnt mezcals
  return;
};

const processMint = (
  UnallocatedMezcals: IUnallocatedMezcals,
  Transaction: IndexedTxExtended,
  storage: Storage
) => {
  const { block, txIndex, mezcalstone } = Transaction;
  const mint = mezcalstone?.mint;

  const { findOne, updateAttribute, create, findOrCreate } = storage;

  if (!mint) {
    return UnallocatedMezcals;
  }
  //We use the same  process used to calculate the Mezcal Id in the etch function if "0:0" is referred to
  const mezcalToMint = findOne<IMezcal>("Mezcal", mint, undefined, true);

  if (!isValidResponse<IMezcal>(mezcalToMint)) {
    //The mezcal requested to be minted does not exist.
    return UnallocatedMezcals;
  }

  if (!isPriceTermsMet(mezcalToMint, Transaction)) {
    return UnallocatedMezcals;
  }

  if (isMintOpen(block, txIndex, mezcalToMint, true)) {
    //Update new mints to count towards cap
    if (mezcalstone.cenotaph) {
      //If the mint is a cenotaph, the minted amount is burnt
      return UnallocatedMezcals;
    }

    let mintAmount = BigInt(mezcalToMint.mint_amount ?? "0");
    let isFlex = mezcalToMint.price_amount != null && mintAmount == 0n;

    if (isFlex) {
      const payTo = mezcalToMint.price_pay_to;
      const priceAmount = mezcalToMint.price_amount;

      if (!payTo) throw new Error("Missing pay_to address in price terms");
      if (!priceAmount || BigInt(priceAmount) === 0n)
        throw new Error("Invalid price amount");

      const totalRecv = Transaction.vout
        .filter((v) => v.scriptPubKey?.address === payTo)
        .map((v) => BigInt(Math.floor(v.value * 1e8)))
        .reduce((a, b) => a + b, 0n);

      mintAmount = totalRecv / BigInt(priceAmount);
    }

    if (mintAmount <= 0n) {
      return UnallocatedMezcals;
    }

    let fromAddressResponse = findOne<IAddress>(
      "Address",
      Transaction.sender ?? "UNKNOWN",
      undefined,
      true
    );

    if (!isValidResponse<IAddress>(fromAddressResponse)) {
      throw new Error("Invalid response from local cache @ mint:1");
    }

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

    return updateUnallocated(UnallocatedMezcals, {
      mezcal_id: mezcalToMint.mezcal_protocol_id,
      amount: BigInt(mintAmount),
    });
  } else {
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
  const { block, txIndex, mezcalstone } = Transaction;

  const etching = mezcalstone?.etching;

  const { findOne, create, local, findOrCreate } = storage;

  //If no etching, return the input allocations
  if (!etching) {
    return UnallocatedMezcals;
  }

  let searchMezcal = findOne<IMezcal>(
    "Mezcal",
    `${block}:${txIndex}`,
    undefined,
    true
  );

  if (isValidResponse<IMezcal>(searchMezcal) || searchMezcal) {
    //If the mezcal is not in the unallocated mezcals, it is ignored
    return UnallocatedMezcals;
  }

  //If mezcal name already taken, it is non standard, return the input allocations

  //Cenotaphs dont have any other etching properties other than their name
  //If not a cenotaph, check if a mezcal name was provided, and if not, generate one

  let mezcalName = etching.mezcal;

  const isMezcalNameTakenResponse = findOne<IMezcal>(
    "Mezcal",
    mezcalName + "@REF@name",
    undefined,
    true
  );

  if (
    isValidResponse<IMezcal>(isMezcalNameTakenResponse) ||
    !!isMezcalNameTakenResponse
  ) {
    return UnallocatedMezcals;
  }

  let isFlex = etching?.terms?.amount == 0n && etching?.terms?.price;
  let hasMintcap = !!etching?.terms?.cap && etching?.terms?.cap !== 0n;

  if (!isFlex && etching?.terms?.amount == 0n) {
    //An etch attempting to use "flex mode" for mint that doesnt provide amount is invalid
    return UnallocatedMezcals;
  }

  if (isFlex && hasMintcap) {
    //An etch attempting to use "flex mode" for mint that provides a mint cap is invalid
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

  const symbol = etching.symbol && isSafeChar ? etching.symbol : "¤";

  const etcherId = findOrCreate<IAddress>(
    "Address",
    Transaction.sender ?? "UNKNOWN",
    { address: Transaction.sender },
    true
  ).id;

  const EtchedMezcal = create<IMezcal>("Mezcal", {
    mezcal_protocol_id: !isGenesis ? `${block}:${txIndex}` : "1:0",
    name: mezcalName,
    symbol,

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
    price_amount: etching.terms?.price?.amount ?? null,
    price_pay_to: etching.terms?.price?.pay_to ?? null,
    turbo: etching.turbo,
    burnt_amount: "0",
    //Unmintable is a flag internal to this indexer, and is set specifically for cenotaphs as per the mezcal spec (see above)
    unmintable:
      mezcalstone.cenotaph || (!etching.terms?.amount && !isFlex) ? 1 : 0,
    etch_transaction_id: Transaction.virtual_id,
    deployer_address_id: etcherId,
  });

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
    //No mezcals are premined if the tx is a cenotaph.
    return UnallocatedMezcals;
  }

  return updateUnallocated(UnallocatedMezcals, {
    mezcal_id: EtchedMezcal.mezcal_protocol_id,
    amount: BigInt(EtchedMezcal.premine),
  });
};

const emitTransferAndBurnEvents = (
  transfers: ITransfers,
  Transaction: IndexedTxExtended,
  storage: Storage
) => {
  const { create, findOrCreate, findOne } = storage;

  Object.keys(transfers).forEach((addressId) => {
    Object.keys(transfers[addressId]).forEach((mezcal_protocol_id) => {
      let amount = transfers[addressId][mezcal_protocol_id];
      if (!amount) return; //Ignore 0 balances

      let foundMezcalResponse = findOne<IMezcal>(
        "Mezcal",
        mezcal_protocol_id,
        undefined,
        true
      );
      if (!isValidResponse<IMezcal>(foundMezcalResponse)) {
        throw new Error(
          "Invalid response from local cache @ emitTransferAndBurnEvents:1"
        );
      }

      create("Event", {
        type: addressId === "burn" ? 3 : 2,
        block: Transaction.block,
        transaction_id: Transaction.virtual_id,
        mezcal_id: foundMezcalResponse.id,
        amount,
        from_address_id: findOrCreate(
          "Address",
          Transaction.sender ?? "UNKNOWN",
          { address: Transaction.sender },
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
  const { updateAttribute, create, local, findOne } = storage;
  const { block, mezcalstone } = Transaction;

  emitTransferAndBurnEvents(transfers, Transaction, storage);

  let opReturnOutput = pendingUtxos.find((utxo) => utxo.address_id === 2);

  //Burn all mezcals from cenotaphs or OP_RETURN outputs (if no cenotaph is present)
  if (mezcalstone.cenotaph) {
    inputUtxos.forEach((utxo) => burnAllFromUtxo(utxo, storage));
  } else if (opReturnOutput) {
    burnAllFromUtxo(opReturnOutput, storage);
  }

  //Update all input UTXOs as spent
  inputUtxos.forEach((utxo) => {
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
  pendingUtxos = pendingUtxos.filter(
    (utxo) =>
      utxo.address_id !== 2 &&
      Object.values(utxo.mezcal_balances ?? {}).reduce(
        (a, b) => a + BigInt(b),
        0n
      ) > 0n
  );
  //Create all new UTXOs and create a map of their ids (remove all OP_RETURN too as they are burnt). Ignore on cenotaphs
  pendingUtxos.forEach((utxo) => {
    if (utxo.address_id !== 2) {
      let resultUtxo = { ...utxo };
      delete resultUtxo.mezcal_balances;

      const parentUtxo = create<IUtxo>(
        "Utxo",
        resultUtxo as Omit<IndexerUtxo, "mezcal_balances">
      );

      let mezcalBalances = utxo.mezcal_balances;
      if (!mezcalBalances) return;

      Object.keys(mezcalBalances).forEach((mezcalProtocolId) => {
        if (!mezcalBalances[mezcalProtocolId]) return; //Ignore 0 balances

        let findMezcalResponse = findOne<IMezcal>(
          "Mezcal",
          mezcalProtocolId,
          undefined,
          true
        );

        if (!isValidResponse<IMezcal>(findMezcalResponse)) {
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

  //Finally update balance store with new Utxos (we can call these at the same time because they are updated in memory, not on db)

  allUtxos.map(([utxo, direction]) =>
    updateOrCreateBalancesWithUtxo(utxo, storage, direction)
  );

  return;
};

const handleGenesis = (
  Transaction: IndexedTxExtended,
  rpc: RpcClient,
  storage: Storage
) => {
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

  const parentTransaction = create<ITransaction>("Transaction", { hash });

  Transaction.virtual_id = Number(parentTransaction.id);

  let addressFound = findOne<IAddress>(
    "Address",
    inputUtxos[0]?.address_id + "@REF@id",
    undefined,
    true
  );

  if (!isValidResponse<IAddress>(addressFound)) {
    addressFound = { address: "UNKNOWN" } as IAddress;
  }

  Transaction.sender =
    //check if it was populated in
    Transaction.sender ??
    //if it wasnt populated in check if its in db froma prev utxo
    addressFound.address;

  if (vin[0].coinbase && block === GENESIS_BLOCK)
    handleGenesis(Transaction, rpc, storage);

  startTimer();

  let pendingUtxos = createNewUtxoBodies(vout, Transaction, storage);

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
  processEtching(UnallocatedMezcals, Transaction, rpc, storage, false, useTest);
  stopTimer("etch");

  //Mints are processed next and added to the MezcalAllocations, with caps being updated (and burnt in case of cenotaphs)

  startTimer();
  processMint(UnallocatedMezcals, Transaction, storage);
  stopTimer("mint");

  //Allocate all transfers from unallocated payload to the pendingUtxos
  startTimer();

  let transfers = {};

  processEdicts(
    UnallocatedMezcals,
    pendingUtxos,
    Transaction,
    transfers,
    storage
  );
  stopTimer("edicts");

  //Commit the utxos to storage and update Balances

  startTimer();
  finalizeTransfers(inputUtxos, pendingUtxos, Transaction, transfers, storage);
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
    [Op.or]: utxosInBlock.map((utxo) => {
      const { transaction_id, vout_index } = utxo;

      return {
        transaction_id,
        vout_index,
      };
    }),
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
