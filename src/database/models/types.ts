import * as Mezcal from "./Mezcal";
import * as Address from "./Address";
import * as Balance from "./Balance";
import * as Events from "./Events";
import * as Settings from "./Settings";
import * as Transaction from "./Transaction";
import * as Utxo from "./Utxo";
import * as UtxoBalance from "./Utxo_balance";

export * from "./Address";
export * from "./Balance";
export * from "./Mezcal";
export * from "./Events";
export * from "./Settings";
export * from "./Transaction";
export * from "./Utxo";
export * from "./Utxo_balance";

export type IMezcalModel = typeof Mezcal.Mezcal;
export type IBalanceModel = typeof Balance.Balance;
export type IAddressModel = typeof Address.Address;
export type ITransactionModel = typeof Transaction.Transaction;
export type IUtxoModel = typeof Utxo.Utxo;
export type IUtxoBalanceModel = typeof UtxoBalance.UtxoBalance;
export type IEventsModel = typeof Events.Event;
export type ISettingsModel = typeof Settings.Setting;
