require("dotenv").config();

const GENESIS_BLOCK = parseInt(process.env.GENESIS_BLOCK ?? "0");
const TAPROOT_ANNEX_PREFIX = 0x50;
const UNLOCK_INTERVAL = 17500; //https://docs.ordinals.com/dunes/specification.html -> Etching the dunestone
const COMMIT_CONFIRMATIONS = 6;
const INITIAL_AVAILABLE = 13; //https://docs.ordinals.com/dunes/specification.html -> Etching the dunestone
const TAPROOT_SCRIPT_PUBKEY_TYPE = "witness_v1_taproot";
const MAX_SIGNED_128_BIT_INT = 0x7fffffffffffffffffffffffffffffffn + 1n;

const GENESIS_DUNESTONE = {
  etching: {
    dune: "duni",
    symbol: "🌵",
    turbo: true,
    terms: {
      amount: 100n,
      cap: 1000000n,
      height: [0, null],
      offset: [null, null],
      price: {
        amount: 21000n,
        pay_to: "bc1qvn6ecmzd42ksa252tntu9yw358yhujcznq9zxs",
      },
    },
  },
};

module.exports = {
  GENESIS_DUNESTONE,
  GENESIS_BLOCK,
  UNLOCK_INTERVAL,
  INITIAL_AVAILABLE,
  TAPROOT_ANNEX_PREFIX,
  COMMIT_CONFIRMATIONS,
  TAPROOT_SCRIPT_PUBKEY_TYPE,
  MAX_SIGNED_128_BIT_INT,
};
