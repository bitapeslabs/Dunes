import * as Dune from "./Dune";
import * as Address from "./Address";
import * as Balance from "./Balance";
import * as Events from "./Events";
import * as Settings from "./Settings";
import * as Transaction from "./Transaction";
import * as Utxo from "./Utxo";
import * as UtxoBalance from "./Utxo_balance";
import {
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  Attributes,
} from "sequelize";

/* ── 1. helper ────────────────────────────────────────── */
/**
 * Recursively replaces every `bigint` with `string`,
 * preserving nullability and array / object shapes.
 */
type BigIntAsString<T> = T extends bigint
  ? string
  : T extends (infer U)[]
  ? BigIntAsString<U>[]
  : T extends CreationOptional<T>
  ? T
  : T;

/* ── 2. re‑export originals ───────────────────────────── */
export * from "./Address";
export * from "./Balance";
export * from "./Dune";
export * from "./Events";
export * from "./Settings";
export * from "./Transaction";
export * from "./Utxo";
export * from "./Utxo_balance";
