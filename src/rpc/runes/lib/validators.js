const bitcoin = require("bitcoinjs-lib");

const ecc = require("tiny-secp256k1");

bitcoin.initEccLib(ecc);
const validators = {
  validInt: (n) => {
    return !(isNaN(n) || n < 0);
  },
  validTransactionHash: (hash) => {
    const regex = /^[a-fA-F0-9]{64}$/;

    // Test the txHash against the regex
    return regex.test(hash);
  },

  validBitcoinAddress: (address) => {
    try {
      bitcoin.address.toOutputScript(address);
      return true;
    } catch (e) {
      return false;
    }
  },
};

module.exports = validators;
