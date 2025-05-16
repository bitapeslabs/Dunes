import { IStorage } from "@/lib/storage";
import { literal } from "sequelize";
import { IJoinedMezcalInstance } from "../lib/queries";
import { Models } from "@/database/createConnection";
import { simplify } from "@/lib/utils";

let cache: ICache = {} as ICache;

type IEtchingsResponse = {
  total_etchings: number;
  etchings: (IJoinedMezcalInstance & {
    total_holders: number;
    holders: IMezcalHolder[] | null;
  })[];
};

type IMezcalHolder = {
  address: string;
  balance: string;
};

type ICache = {
  "rpc:etchings:all": IEtchingsResponse;
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
  })) as (IJoinedMezcalInstance & {
    total_holders: number;
    holders: IMezcalHolder[] | null;
  })[]; // 'holders' will be added dynamically

  return {
    total_etchings: etchings.length,
    etchings: etchings.map((e) => simplify(e.toJSON())),
  };
};

export const clearAndPopulateRpcCache = async (db: Models) => {
  let etchings = await getUpdatedEtchings(db);
  cache["rpc:etchings:all"] = etchings;
  return;
};

export default cache;
