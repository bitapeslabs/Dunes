const RUNE_GENESIS_BLOCK = 840000;
const TAPROOT_ANNEX_PREFIX = 0x50;
const UNLOCK_INTERVAL = 17500; //https://docs.ordinals.com/runes/specification.html -> Etching the runestone
const COMMIT_CONFIRMATIONS = 6;
const INITIAL_AVAILABLE = 13; //https://docs.ordinals.com/runes/specification.html -> Etching the runestone
const TAPROOT_SCRIPT_PUBKEY_TYPE = "witness_v1_taproot";
module.exports = {
  RUNE_GENESIS_BLOCK,
  UNLOCK_INTERVAL,
  INITIAL_AVAILABLE,
  TAPROOT_ANNEX_PREFIX,
  COMMIT_CONFIRMATIONS,
  TAPROOT_SCRIPT_PUBKEY_TYPE,
};
