const {
  simplify,
  mergeSortArrayOfObj,
  binarySearchLastOccurrence,
  binarySearchFirstOccurrence,
  binarySearchClosestUpper,
  mergeSort,
} = require("../../../lib/utils");
let __debug_totalElapsedTime = {};
let __timer;

let startTimer = () => {
  __timer = Date.now();
};

let stopTimer = (field) => {
  __debug_totalElapsedTime[field] =
    (__debug_totalElapsedTime[field] ?? 0) + Date.now() - __timer;
};
const parseBalances = (rawBalances, excludeDune) => {
  return rawBalances.reduce((acc, entry) => {
    if (!acc[entry.dune.dune_protocol_id]) {
      acc[entry.dune.dune_protocol_id] = {
        balance: 0n,
        dune: entry.dune,
      };
    }
    acc[entry.dune.dune_protocol_id].balance = (
      BigInt(acc[entry.dune.dune_protocol_id].balance) + BigInt(entry.balance)
    ).toString();

    if (excludeDune) {
      delete acc[entry.dune.dune_protocol_id].dune;
    }

    return acc;
  }, {});
};

const parseBalancesIntoAddress = (rawBalances) => {
  return simplify({
    address: rawBalances[0].address,
    balances: parseBalances(rawBalances),
  });
};

const parseBalancesIntoUtxo = (rawUtxoBalances) => {
  return simplify({
    ...rawUtxoBalances[0].utxo,
    balances: parseBalances(rawUtxoBalances),
  });
};

const parsePrevUtxoBalancesIntoAddress = (
  rawUtxoBalances,
  startBlock,
  endBlock
) => {
  startTimer();
  let balances = new Array(endBlock - startBlock + 1)
    .fill(0)
    .reduce((acc, _, i) => {
      acc[startBlock + i] = {};
      return acc;
    }, {});

  for (let utxoBalance of rawUtxoBalances) {
    let { block, block_spent } = utxoBalance.utxo;
    block_spent = block_spent ?? endBlock;
    let [start, end] = [
      block >= startBlock ? block : startBlock,
      block_spent <= endBlock ? block_spent : endBlock,
    ];

    for (let current = start; current <= end; current++) {
      if (!balances[current][utxoBalance.dune.dune_protocol_id])
        balances[current][utxoBalance.dune.dune_protocol_id] = "0";

      balances[current][utxoBalance.dune.dune_protocol_id] = (
        BigInt(balances[current][utxoBalance.dune.dune_protocol_id]) +
        BigInt(utxoBalance.balance)
      ).toString();
    }
  }

  stopTimer("calc");
  console.log(__debug_totalElapsedTime);
  return {
    address: rawUtxoBalances[0].utxo.address,
    balances,
  };
};

module.exports = {
  parseBalancesIntoUtxo,
  parseBalancesIntoAddress,
  parsePrevUtxoBalancesIntoAddress,
};
