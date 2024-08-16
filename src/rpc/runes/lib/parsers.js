const { simplify } = require("../../../lib/utils");

const parseBalances = (rawBalances) => {
  return rawBalances.reduce((acc, entry) => {
    if (!acc[entry.rune.rune_protocol_id]) {
      acc[entry.rune.rune_protocol_id] = {
        balance: 0n,
        rune: entry.rune,
      };
    }
    acc[entry.rune.rune_protocol_id].balance = (
      BigInt(acc[entry.rune.rune_protocol_id].balance) + BigInt(entry.balance)
    ).toString();

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

const parsePrevUtxoBalancesIntoAddress = (rawUtxoBalances) => {
  return simplify({
    address: rawUtxoBalances[0].utxo.address,
    balances: parseBalances(rawUtxoBalances),
  });
};

module.exports = {
  parseBalancesIntoUtxo,
  parseBalancesIntoAddress,
  parsePrevUtxoBalancesIntoAddress,
};
