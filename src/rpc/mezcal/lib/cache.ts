import { IStorage } from "@/lib/storage";
import { literal } from "sequelize";
import {
  IJoinedMezcal,
  IJoinedMezcalInstance,
  IJoinedUtxoBalance,
  IJoinedUtxoBalanceInstance,
} from "../lib/queries";
import { getSomeUtxoBalance } from "../lib/queries";
import { Models } from "@/database/createConnection";
import { simplify, stripFields } from "@/lib/utils";
import { Op, col, where } from "sequelize";
import { IEvent } from "@/database/models/types";

let cache: ICache = {} as ICache;

export type IGenericFullMezcal<
  T extends IJoinedMezcalInstance | IJoinedMezcal
> = T & {
  total_holders: number;
  holders: IMezcalHolder[] | null;
};

type IEtchingsResponse = {
  total_etchings: number;
  etchings: IGenericFullMezcal<IJoinedMezcal>[];
};

type IMezcalHolder = {
  address: string;
  balance: string;
};

export type IMezcalBalance = {
  balance: string;
  mezcal: IGenericFullMezcal<IJoinedMezcal>;
};

type IMezcalBalancesMappedByAddress = {
  [address: string]: IMezcalBalance[];
};

type IMezcalEtchingsMappedByProtocolId = {
  [mezcal_protocol_id: string]: IGenericFullMezcal<IJoinedMezcal>;
};

type IMezcalEtchingsMappedById = {
  [id: number]: IGenericFullMezcal<IJoinedMezcal>;
};

type IMezcalEtchingsMappedByLowercaseName = {
  [lowercase_name: string]: IGenericFullMezcal<IJoinedMezcal>;
};

type IMezcalUtxoBalancesMappedByAddress = {
  [address: string]: IJoinedUtxoBalance[];
};

type IMezcalEventsMappedByAddress = {
  [address: string]: IJoinedEvent[];
};

type IMezcalEventsMappedByTxid = {
  [txid: string]: IJoinedEvent[];
};

export type IJoinedEvent = {
  id: string; // BIGINT → string
  type: number; // 0 = Etch, 1 = Mint, 2 = Transfer, 3 = Burn
  block: number;
  transaction: string | null; // BIGINT → string
  mezcal: IGenericFullMezcal<IJoinedMezcal> | null;
  amount: string; // DECIMAL → string
  from_address: string | null; // BIGINT → string
  to_address: string | null; // BIGINT → string
};

type IJoinedEventUnparsed = Omit<IJoinedEvent, "mezcal"> & {
  mezcal_id: number;
};

type ICache = {
  "rpc:etchings:all": IEtchingsResponse;
  "rpc:etchings:mapped_by_protocol_id": IMezcalEtchingsMappedByProtocolId;
  "rpc:etchings:mapped_by_id": IMezcalEtchingsMappedById;
  "rpc:etchings:mapped_by_lowercase_name": IMezcalEtchingsMappedByLowercaseName;
  "rpc:balances:mapped_by_address": IMezcalBalancesMappedByAddress;
  "rpc:utxo_balances:all": IJoinedUtxoBalance[];
  "rpc:utxo_balances:mapped_by_address": IMezcalUtxoBalancesMappedByAddress;
  "rpc:events:all": IJoinedEvent[];
  "rpc:events:mapped_by_address": IMezcalEventsMappedByAddress;
  "rpc:events:mapped_by_txid": IMezcalEventsMappedByTxid;
};

const getUpdatedEvents = async (db: Models): Promise<IJoinedEvent[]> => {
  const { Event, Address, Transaction, Mezcal } = db;

  //DONT include mezcal obj, we will  use references from cached mezcals
  const events = await Event.findAll({
    order: [["id", "DESC"]],
    attributes: {
      exclude: [
        "createdAt",
        "updatedAt",
        "from_address_id",
        "to_address_id",
        "transaction_id",
      ],
    },
    include: [
      {
        model: Address,
        as: "from_address",
        attributes: ["address"],
        required: false,
      },
      {
        model: Address,
        as: "to_address",
        attributes: ["address"],
        required: false,
      },
      {
        model: Transaction,
        as: "transaction",
        attributes: {
          exclude: ["id", "createdAt", "updatedAt", "logs", "block"],
        },
        required: false,
      },
    ],
    where: where(col("from_address.address"), {
      [Op.ne]: col("to_address.address"),
    }),
  });

  //trust me bro
  const parsedEvents: IJoinedEventUnparsed[] = events.map(
    (e) => e.toJSON() as unknown as IJoinedEventUnparsed
  );

  return parsedEvents.map((event: IJoinedEventUnparsed) =>
    simplify({
      ...stripFields(event, ["mezcal_id"]),
      mezcal: cacheGetEtchingByModelId(event.mezcal_id),
    })
  ) as IJoinedEvent[]; //parse into IJoinedEvent (only mezcal_id is undefined now even tho stripFields adds union of undefined to all)
};

const getUpdatedUtxoBalances = async (
  db: Models
): Promise<IJoinedUtxoBalance[]> => {
  const { Utxo_balance } = db;

  //Get all UTXO balances on DB that are unspent and have a mezcal
  const query = getSomeUtxoBalance(db, {
    utxo: { address: {}, block_spent: null },
  });

  const balances = (await Utxo_balance.findAll({
    ...query,
  })) as unknown as IJoinedUtxoBalanceInstance[];

  return balances.map((b) => simplify(b.toJSON()));
};

const getUpdatedEtchings = async (db: Models): Promise<IEtchingsResponse> => {
  const { Mezcal, Transaction, Address } = db;

  const etchings = (await Mezcal.findAll({
    include: [
      {
        model: Transaction,
        as: "etch_transaction",
        attributes: ["hash"],
        required: false,
      },
      {
        model: Address,
        as: "deployer_address",
        attributes: ["address"],
        required: false,
      },
    ],
    order: [["id", "ASC"]],
    subQuery: true,
    attributes: {
      include: [
        [
          literal(`
            (
              SELECT COUNT(*)
              FROM "balances" AS "b"
              WHERE "b"."mezcal_id" = "_Mezcal"."id"
            )
          `),
          "total_holders",
        ],
        [
          literal(`
    (
      SELECT json_agg(json_build_object(
        'address', a.address,
        'balance', b.balance
      ) ORDER BY b.balance DESC)
      FROM balances b
      JOIN addresses a ON a.id = b.address_id
      WHERE b.mezcal_id = "_Mezcal"."id"
        AND b.balance > 0
    )
  `),
          "holders",
        ],
      ],
      exclude: ["etch_transaction_id", "deployer_address_id"],
    },
  })) as IGenericFullMezcal<IJoinedMezcalInstance>[];

  return {
    total_etchings: etchings.length,
    etchings: etchings.map(
      (mezcal: IGenericFullMezcal<IJoinedMezcalInstance>) =>
        simplify<IGenericFullMezcal<IJoinedMezcal>>(mezcal.toJSON())
    ),
  };
};

export const clearAndPopulateRpcCache = async (db: Models) => {
  let etchings = await getUpdatedEtchings(db);
  let utxoBalances = await getUpdatedUtxoBalances(db);
  cache["rpc:etchings:all"] = etchings;
  cache["rpc:utxo_balances:all"] = utxoBalances;

  cache["rpc:etchings:mapped_by_id"] = etchings.etchings.reduce(
    (
      acc: IMezcalEtchingsMappedById,
      mezcal: IGenericFullMezcal<IJoinedMezcal>
    ) => {
      acc[mezcal.id] = mezcal;
      return acc;
    },
    {} as IMezcalEtchingsMappedById
  );

  let events = await getUpdatedEvents(db);
  cache["rpc:events:all"] = events;

  cache["rpc:etchings:mapped_by_protocol_id"] = etchings.etchings.reduce(
    (
      acc: IMezcalEtchingsMappedByProtocolId,
      mezcal: IGenericFullMezcal<IJoinedMezcal>
    ) => {
      acc[mezcal.mezcal_protocol_id] = mezcal;
      return acc;
    },
    {} as IMezcalEtchingsMappedByProtocolId
  );

  cache["rpc:etchings:mapped_by_lowercase_name"] = etchings.etchings.reduce(
    (
      acc: IMezcalEtchingsMappedByLowercaseName,
      mezcal: IGenericFullMezcal<IJoinedMezcal>
    ) => {
      acc[mezcal.name.toLowerCase()] = mezcal;
      return acc;
    },
    {} as IMezcalEtchingsMappedByLowercaseName
  );

  cache["rpc:balances:mapped_by_address"] = etchings.etchings.reduce(
    (
      acc: IMezcalBalancesMappedByAddress,
      mezcal: IGenericFullMezcal<IJoinedMezcal>
    ) => {
      mezcal.holders?.forEach((holder: IMezcalHolder) => {
        if (!acc[holder.address]) {
          acc[holder.address] = [];
        }
        acc[holder.address].push({
          balance: holder.balance,
          mezcal: mezcal,
        });
      });
      return acc;
    },
    {} as IMezcalBalancesMappedByAddress
  );

  cache["rpc:utxo_balances:mapped_by_address"] = utxoBalances.reduce(
    (
      acc: IMezcalUtxoBalancesMappedByAddress,
      utxoBalance: IJoinedUtxoBalance
    ) => {
      if (!acc[utxoBalance.utxo.address]) {
        acc[utxoBalance.utxo.address] = [];
      }
      acc[utxoBalance.utxo.address].push(utxoBalance);
      return acc;
    },
    {} as IMezcalUtxoBalancesMappedByAddress
  );

  cache["rpc:events:mapped_by_address"] = events.reduce(
    (acc: IMezcalEventsMappedByAddress, event: IJoinedEvent) => {
      if (event.from_address) {
        if (!acc[event.from_address]) {
          acc[event.from_address] = [];
        }
        acc[event.from_address].push(event);
      }

      if (event.to_address) {
        if (!acc[event.to_address]) {
          acc[event.to_address] = [];
        }
        acc[event.to_address].push(event);
      }

      return acc;
    },
    {} as IMezcalEventsMappedByAddress
  );
  cache["rpc:events:mapped_by_txid"] = events.reduce(
    (acc: IMezcalEventsMappedByTxid, event: IJoinedEvent) => {
      if (!event.transaction) {
        return acc;
      }

      if (!acc[event.transaction]) {
        acc[event.transaction] = [];
      }
      acc[event.transaction].push(event);
      return acc;
    },
    {} as IMezcalEventsMappedByTxid
  );

  return;
};

//Cache helper functions

export const cacheGetSingleEtchingByIdentifier = (
  identifier: string
): IGenericFullMezcal<IJoinedMezcal> | null => {
  if (cache["rpc:etchings:mapped_by_protocol_id"][identifier]) {
    return cache["rpc:etchings:mapped_by_protocol_id"][identifier];
  }
  if (
    cache["rpc:etchings:mapped_by_lowercase_name"][identifier.toLowerCase()]
  ) {
    return cache["rpc:etchings:mapped_by_lowercase_name"][
      identifier.toLowerCase()
    ];
  }
  return null;
};

export const cacheGetAllEtchings = (): IEtchingsResponse | null => {
  if (cache["rpc:etchings:all"]) {
    return cache["rpc:etchings:all"];
  }
  return null;
};

export const cacheGetBalancesByAddress = (
  address: string
): IMezcalBalance[] | null => {
  if (cache["rpc:balances:mapped_by_address"][address]) {
    return cache["rpc:balances:mapped_by_address"][address];
  }
  return null;
};

export const cacheGetAllUtxoBalances = (): IJoinedUtxoBalance[] | null => {
  if (cache["rpc:utxo_balances:all"]) {
    return cache["rpc:utxo_balances:all"];
  }
  return null;
};

export const cacheGetEtchingByModelId = (
  id: number
): IGenericFullMezcal<IJoinedMezcal> | null => {
  if (cache["rpc:etchings:mapped_by_id"][id]) {
    return cache["rpc:etchings:mapped_by_id"][id];
  }
  return null;
};

export const cacheGetUtxoBalancesByAddress = (
  address: string
): IJoinedUtxoBalance[] | null => {
  if (cache["rpc:utxo_balances:mapped_by_address"][address]) {
    return cache["rpc:utxo_balances:mapped_by_address"][address];
  }
  return null;
};
export const cacheGetEventsByAddress = (
  address: string
): IJoinedEvent[] | null => {
  if (cache["rpc:events:mapped_by_address"][address]) {
    return cache["rpc:events:mapped_by_address"][address];
  }
  return null;
};

export const cacheGetEventsByTxid = (txid: string): IJoinedEvent[] | null => {
  if (cache["rpc:events:mapped_by_txid"][txid]) {
    return cache["rpc:events:mapped_by_txid"][txid];
  }
  return null;
};
