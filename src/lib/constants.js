require("dotenv").config();

const GENESIS_BLOCK = 4326248;
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
      cap: 10000n,
      height: [4326248, null],
      offset: [null, null],
      price: {
        amount: 21000n,
        pay_to: "tb1p8888zulc047mg3mf252tqeagc2feeh8a2pqn87arzd80t9qdkgcqkf8y5h",
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
