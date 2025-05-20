export enum EsploraFetchError {
  UnknownError = "UnknownError",
}

export type EsploraAddressStats = {
  funded_txo_count: number;
  funded_txo_sum: number;
  spent_txo_count: number;
  spent_txo_sum: number;
  tx_count: number;
};

export type EsploraAddressResponse = {
  address: string;
  chain_stats: EsploraAddressStats;
  mempool_stats: EsploraAddressStats;
};

export type EsploraUtxo = {
  txid: string;
  vout: number;
  value: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
};

/* ────────────  Esplora TX types  ──────────── */

/** Block-confirmation status for a tx */
export type IEsploraTransactionStatus = {
  confirmed: boolean;
  block_height?: number;
  block_hash?: string;
  block_time?: number; // UNIX epoch (s)
};

/** The prevout object that appears inside each `vin` */
export type IEsploraPrevout = {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address: string;
  value: number; // sats
};

/** One input */
export type IEsploraVin = {
  txid: string;
  vout: number;
  prevout: IEsploraPrevout;
  scriptsig: string;
  scriptsig_asm: string;
  witness: string[];
  is_coinbase: boolean;
  sequence: number;
};

/** One output */
export type IEsploraVout = {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address: string;
  value: number; // sats
};

/** 👉  The main transaction object you’ll usually store */
export type IEsploraTransaction = {
  txid: string;
  version: number;
  locktime: number;
  vin: IEsploraVin[];
  vout: IEsploraVout[];
  size: number; // bytes
  weight: number; // wu
  fee: number; // sats
  status: IEsploraTransactionStatus;
};
