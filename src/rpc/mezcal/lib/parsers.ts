import { simplify } from "../../../lib/utils";
import {
  IUtxoBalance,
  IMezcal,
  IUtxo,
  IAddress,
} from "@/database/createConnection";

import { IJoinedBalance, IJoinedUtxoBalance } from "./queries";

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
  [mezcal_protocol_id: string]: {
    balance: string;
    mezcal?: IMezcal;
  };
};

const parseBalances = <T extends IJoinedUtxoBalance | IJoinedBalance>(
  rawBalances: T[],
  excludeMezcal = false
): ParsedBalance => {
  return rawBalances.reduce<ParsedBalance>((acc, entry) => {
    const mezcalId = entry.mezcal?.mezcal_protocol_id;
    if (!mezcalId) return acc;

    if (!acc[mezcalId]) {
      acc[mezcalId] = {
        balance: "0",
        mezcal: entry.mezcal,
      };
    }

    acc[mezcalId].balance = (
      BigInt(acc[mezcalId].balance) + BigInt(entry.balance ?? "0")
    ).toString();

    if (excludeMezcal) {
      delete acc[mezcalId].mezcal;
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
    const mezcal = utxoBalance.mezcal;
    if (!utxo || !mezcal?.mezcal_protocol_id) continue;

    let block = utxo.block;
    let block_spent = utxo.block_spent ?? endBlock;

    const start = Math.max(block, startBlock);
    const end = Math.min(block_spent, endBlock);

    for (let current = start; current <= end; current++) {
      const protoId = mezcal.mezcal_protocol_id;
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
