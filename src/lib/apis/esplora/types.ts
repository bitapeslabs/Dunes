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
  prevtx_hex: string;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
};

export type IEsploraTransactionStatus = {
  confirmed: boolean;
  block_height?: number;
  block_hash?: string;
  block_time?: number;
};

export type IEsploraPrevout = {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address: string;
  value: number;
};

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

export type IEsploraVout = {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address: string;
  value: number;
};

export type IEsploraTransaction = {
  txid: string;
  version: number;
  locktime: number;
  vin: IEsploraVin[];
  vout: IEsploraVout[];
  size: number;
  weight: number;
  fee: number;
  status: IEsploraTransactionStatus;
};

export type IEsploraSpendableUtxo = {
  txid: string;
  vout: number;
  value: number;
  prevTx: IEsploraTransaction & { hex: string };
};
