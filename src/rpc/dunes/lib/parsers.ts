import { simplify } from "../../../lib/utils";
import {
  IUtxoBalance,
  IDune,
  IUtxo,
  IAddress,
} from "@/database/createConnection";

import { IJoinedBalance, IJoinedUtxoBalance } from "../lib/queries";

let __debug_totalElapsedTime: Record<string, number> = {};
let __timer = 0;

const startTimer = (): void => {
  __timer = Date.now();
};

const stopTimer = (field: string): void => {
  __debug_totalElapsedTime[field] =
    (__debug_totalElapsedTime[field] ?? 0) + Date.now() - __timer;
};

type ParsedBalance = {
  [dune_protocol_id: string]: {
    balance: string;
    dune?: IDune;
  };
};

const parseBalances = <T extends IJoinedUtxoBalance | IJoinedBalance>(
  rawBalances: T[],
  excludeDune = false
): ParsedBalance => {
  return rawBalances.reduce<ParsedBalance>((acc, entry) => {
    const duneId = entry.dune?.dune_protocol_id;
    if (!duneId) return acc;

    if (!acc[duneId]) {
      acc[duneId] = {
        balance: "0",
        dune: entry.dune,
      };
    }

    acc[duneId].balance = (
      BigInt(acc[duneId].balance) + BigInt(entry.balance ?? "0")
    ).toString();

    if (excludeDune) {
      delete acc[duneId].dune;
    }

    return acc;
  }, {});
};

const parseBalancesIntoAddress = (rawBalances: IJoinedBalance[]) => {
  const address = rawBalances[0]?.address?.address;
  return simplify({
    address,
    balances: parseBalances(rawBalances),
  });
};

const parseBalancesIntoUtxo = (rawUtxoBalances: IJoinedUtxoBalance[]) => {
  const utxo = rawUtxoBalances[0]?.utxo;
  return simplify({
    ...utxo,
    balances: parseBalances(rawUtxoBalances),
  });
};

const parsePrevUtxoBalancesIntoAddress = (
  rawUtxoBalances: IJoinedUtxoBalance[],
  startBlock: number,
  endBlock: number
) => {
  startTimer();

  const balances: Record<number, Record<string, string>> = {};
  for (let i = startBlock; i <= endBlock; i++) {
    balances[i] = {};
  }

  for (const utxoBalance of rawUtxoBalances) {
    const utxo = utxoBalance.utxo;
    const dune = utxoBalance.dune;
    if (!utxo || !dune?.dune_protocol_id) continue;

    let block = utxo.block;
    let block_spent = utxo.block_spent ?? endBlock;

    const start = Math.max(block, startBlock);
    const end = Math.min(block_spent, endBlock);

    for (let current = start; current <= end; current++) {
      const protoId = dune.dune_protocol_id;
      if (!balances[current][protoId]) {
        balances[current][protoId] = "0";
      }

      balances[current][protoId] = (
        BigInt(balances[current][protoId]) + BigInt(utxoBalance.balance ?? "0")
      ).toString();
    }
  }

  stopTimer("calc");
  console.log(__debug_totalElapsedTime);

  return {
    address: rawUtxoBalances[0]?.utxo?.address?.address ?? "UNKNOWN",
    balances,
  };
};

export {
  parseBalances,
  parseBalancesIntoUtxo,
  parseBalancesIntoAddress,
  parsePrevUtxoBalancesIntoAddress,
};
