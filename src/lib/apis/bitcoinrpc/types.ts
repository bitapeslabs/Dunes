export type GetBlockCountResponse = Number;

export type GetBlockHashResponse = string;

export interface VinScriptSig {
  asm: string;
  hex: string;
}

export interface Vin {
  coinbase?: string;
  txid: string;
  vout: number;
  scriptSig?: VinScriptSig;
  sequence: number;
  txinwitness?: string[];
}

export interface ScriptPubKey {
  asm: string;
  hex: string;
  type: string;
  address?: string;
  addresses?: string[];
}

export interface Vout {
  value: number;
  n: number;
  scriptPubKey: ScriptPubKey;
}

export interface Transaction {
  txid: string;
  hash: string;
  size: number;
  vsize: number;
  version: number;
  locktime: number;
  vin: Vin[];
  vout: Vout[];
  hex?: string;
  blockhash?: string;
  confirmations?: number;
  time?: number;
  blocktime?: number;
}

export interface Block {
  hash: string;
  confirmations: number;
  size: number;
  height: number;
  version: number;
  versionHex: string;
  merkleroot: string;
  tx: Transaction[];
  time: number;
  mediantime: number;
  nonce: number;
  bits: string;
  difficulty: number;
  chainwork: string;
  nTx: number;
  previousblockhash?: string;
  nextblockhash?: string;
}
