/* ────────────────────────────────────────────────────────────────────────────
   queries.ts  (strict TypeScript, no external includes)
   ────────────────────────────────────────────────────────────────────────── */

import { IncludeOptions, WhereOptions, Model } from "sequelize";
import { stripFields } from "../../../lib/utils";
import {
  Models,
  IAddress,
  IBalance,
  IDune,
  IUtxo,
  IUtxoBalance,
  ITransaction,
} from "@/database/createConnection";

/* ------------------------------------------------------------------ helpers */

type MaybeWhere<T> = WhereOptions<T> | undefined;

/** Convert `null` → `undefined` because Sequelize expects `undefined`. */
const safeWhere = <T>(w: MaybeWhere<T> | null): MaybeWhere<T> =>
  w === null ? {} : w;

// ───── Joined Types ─────
export type IDuneWhereOptions = WhereOptions<IDune> & {
  etch_transaction?: ITransactionWhereOptions;
  deployer_address?: WhereOptions<IAddress>;
};

export type IUtxoWhereOptions = WhereOptions<IUtxo> & {
  transaction?: ITransactionWhereOptions;
  transaction_spent?: ITransactionWhereOptions;
  address?: WhereOptions<IAddress>;
};

export type IUtxoBalanceWhereOptions = WhereOptions<IUtxoBalance> & {
  utxo?: IUtxoWhereOptions;
  dune?: IDuneWhereOptions;
};

export type IBalanceWhereOptions = WhereOptions<IBalance> & {
  address?: WhereOptions<IAddress>;
  dune?: IDuneWhereOptions;
};

export type ITransactionWhereOptions = WhereOptions<ITransaction> & {
  address?: WhereOptions<IAddress>;
};

export type IJoinedDune = IDune & {
  etch_transaction: ITransaction;
  deployer_address: IAddress | null;
};

export type IJoinedDuneInstance = Model<IJoinedDune> & IJoinedDune;

export type IJoinedUtxo = IUtxo & {
  transaction: ITransaction | null;
  transaction_spent: ITransaction | null;
  address: IAddress | null;
};

export type IJoinedUtxoInstance = Model<IJoinedUtxo> & IJoinedUtxo;

export type IJoinedUtxoBalance = IUtxoBalance & {
  utxo: IUtxo & { address: IAddress | null };
  dune: IDune;
};

export type IJoinedUtxoBalanceInstance = Model<IJoinedUtxoBalance> &
  IJoinedUtxoBalance;

export type IJoinedBalance = IBalance & {
  address: IAddress;
  dune: IDune;
};

export type IJoinedBalanceInstance = Model<IJoinedBalance> & IJoinedBalance;

export type IJoinedTransaction = ITransaction & {
  address: IAddress | null;
};

export type IJoinedTransactionInstance = Model<IJoinedTransaction> &
  IJoinedTransaction;
const IncludeTransaction = (
  models: Models,
  as?: string | null,
  where?: MaybeWhere<ITransaction>
): IncludeOptions => ({
  model: models.Transaction,
  as: as ?? "transaction",
  where: safeWhere(where),
  attributes: ["hash"],
});

const IncludeAddress = (
  models: Models,
  as?: string | null,
  where?: MaybeWhere<IAddress>
): IncludeOptions => ({
  model: models.Address,
  as: as ?? "address",
  where: safeWhere(where),
  attributes: ["address"],
});

const IncludeDune = (
  models: Models,
  as?: string | null,
  where?: IDuneWhereOptions
): IncludeOptions => ({
  model: models.Dune,
  as: as ?? "dune",
  where: safeWhere(
    stripFields(where ?? {}, ["etch_transaction", "deployer_address"])
  ),
  include: [
    IncludeTransaction(models, "etch_transaction", where?.etch_transaction),
    IncludeAddress(models, "deployer_address", where?.deployer_address),
  ],
  attributes: { exclude: ["deployer_address_id", "etch_transaction_id", "id"] },
});

const IncludeUtxo = (
  models: Models,
  as?: string | null,
  where?: Partial<IUtxoWhereOptions>
): IncludeOptions => ({
  model: models.Utxo,
  as: as ?? "utxo",
  where: safeWhere(
    stripFields(where ?? {}, ["transaction", "transaction_spent", "address"])
  ),
  include: [
    IncludeTransaction(models, "transaction", where?.transaction),
    IncludeTransaction(models, "transaction_spent", where?.transaction_spent),
    IncludeAddress(models, undefined, where?.address),
  ],
  attributes: {
    exclude: ["address_id", "transaction_id", "transaction_spent_id", "id"],
  },
});

/* ------------------------------------------------------------------ queries */

/** Address‑level balances */
const getSomeAddressBalance = (
  models: Models,
  where?: Partial<IBalanceWhereOptions>
): IncludeOptions => ({
  model: models.Balance,
  where: safeWhere(
    stripFields(where ?? {}, ["address", "dune"]) as MaybeWhere<IBalance>
  ),
  include: [
    IncludeAddress(models, undefined, where?.address),
    IncludeDune(models, undefined, where?.dune),
  ],
  attributes: { exclude: ["address_id", "dune_id", "id"] },
});

/** UTXO‑level balances */
const getSomeUtxoBalance = (
  models: Models,
  where?: Partial<IUtxoBalanceWhereOptions>
): IncludeOptions => ({
  model: models.Utxo_balance,
  where: safeWhere(
    stripFields(where ?? {}, ["utxo", "dune"]) as MaybeWhere<IUtxoBalance>
  ),
  include: [
    IncludeUtxo(models, undefined, where?.utxo),
    IncludeDune(models, undefined, where?.dune),
  ],
  attributes: { exclude: ["utxo_id", "dune_id", "id"] },
});

/* ------------------------------------------------------------------ exports */

export { getSomeAddressBalance, getSomeUtxoBalance };
