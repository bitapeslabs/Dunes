const {
  GENESIS_BLOCK,
  UNLOCK_INTERVAL,
  INITIAL_AVAILABLE,
  TAPROOT_ANNEX_PREFIX,
  COMMIT_CONFIRMATIONS,
  TAPROOT_SCRIPT_PUBKEY_TYPE,
} = require("./constants");

const { Rune: OrdJSRune } = require("@ordjs/runestone");
const { Script } = require("@cmdcode/tapscript");
const { runestone } = require("@runeapes/apeutils");
const { stripObject } = require("./utils");
const { log } = require("./utils");
const decipherRunestone = (txJson) => {
  let decodedBlob = stripObject(runestone.decipher(txJson.hex) ?? {});

  //Cenotaph objects and Runestones are both treated as runestones, the differentiation in processing is done at the indexer level
  return {
    ...decodedBlob?.Runestone,
    ...decodedBlob?.Cenotaph,
    cenotaph:
      !!decodedBlob?.Cenotaph ||
      (!decodedBlob?.Runestone &&
        !!txJson.vout.filter((utxo) =>
          //PUSHNUM_13 is CRUCIAL for defining a cenotaph, if just an "OP_RETURN" is present, its treated as a normal tx
          utxo.scriptPubKey.asm.includes("OP_RETURN 13")
        ).length),
  };
};

const getRunestonesInBlock = async (blockNumber, callRpc) => {
  const blockHash = await callRpc("getblockhash", [parseInt(blockNumber)]);

  const block = await callRpc("getblock", [blockHash, 2]);

  const transactions = block.tx;

  const runestones = transactions.map((tx, txIndex) => ({
    runestone: decipherRunestone(tx),
    hash: tx.txid,
    txIndex,
    block: blockNumber,
    vout: tx.vout,
    vin: tx.vin,
    hex: tx.hex,
  }));

  return runestones;
};
const getReservedName = (block, tx) => {
  const baseValue = BigInt("6402364363415443603228541259936211926");
  const combinedValue = (BigInt(block) << 32n) | BigInt(tx);
  return Rune(baseValue + combinedValue)?.name;
};

const minimumLengthAtHeight = (block) => {
  const stepsPassed = Math.floor((block - GENESIS_BLOCK) / UNLOCK_INTERVAL);

  return INITIAL_AVAILABLE - stepsPassed;
};

const checkCommitment = async (runeName, Transaction, block, callRpc) => {
  //Credits to @me-foundation/runestone-lib for this function.
  //Modified to fit this indexer.

  const commitment = getCommitment(runeName).toString("hex");

  for (const input of Transaction.vin) {
    if ("coinbase" in input) {
      continue;
    }

    const witnessStack = input.txinwitness.map((item) =>
      Buffer.from(item, "hex")
    );

    const lastWitnessElement = witnessStack[witnessStack.length - 1];
    const offset =
      witnessStack.length >= 2 && lastWitnessElement[0] === TAPROOT_ANNEX_PREFIX
        ? 3
        : 2;
    if (offset > witnessStack.length) {
      continue;
    }

    const potentiallyTapscript = witnessStack[witnessStack.length - offset];
    if (potentiallyTapscript === undefined) {
      continue;
    }

    const witnessStackDecompiled = input.txinwitness
      .map((hex) => {
        try {
          let decoded = Script.decode(hex);
          return decoded;
        } catch (e) {
          return false;
        }
      })

      .filter((stack) => stack) //remove compilation errors
      .filter((stack) => stack.includes(commitment)); //decode witness scripts and search for commitment endian

    if (!witnessStackDecompiled.length) {
      continue;
    }

    //valid commitment, check for confirmations
    try {
      let inputTx = await callRpc("getrawtransaction", [input.txid, true]);

      const isTaproot =
        inputTx.vout[input.vout].scriptPubKey.type ===
        TAPROOT_SCRIPT_PUBKEY_TYPE;

      if (!isTaproot) {
        continue;
      }

      const blockHeight = await callRpc("getblockheader", [inputTx.blockhash]);

      const confirmations = block - blockHeight + 1;

      if (confirmations >= COMMIT_CONFIRMATIONS) return true;
    } catch (e) {
      log("RPC failed during commitment check", "panic");
      throw "RPC Error during commitment check";
    }
  }

  return false;
};

const getCommitment = (runeName) => {
  const value = OrdJSRune.fromString(runeName).value;
  const bytes = Buffer.alloc(16);
  bytes.writeBigUInt64LE(0xffffffff_ffffffffn & value, 0);
  bytes.writeBigUInt64LE(value >> 64n, 8);

  let end = bytes.length;
  while (end > 0 && bytes.at(end - 1) === 0) {
    end--;
  }

  return bytes.subarray(0, end);
};

const updateUnallocated = (prevUnallocatedRunes, Allocation) => {
  /*
    An "Allocation" looks like the following:
    {
        rune_id: string,
        amount: BigInt
    }
  */

  prevUnallocatedRunes[Allocation.rune_id] =
    BigInt(prevUnallocatedRunes[Allocation.rune_id] ?? "0") + Allocation.amount;
  return prevUnallocatedRunes;
};

const isMintOpen = (block, txIndex, Rune, mint_offset = false) => {
  /*
    if mint_offset is false, this function uses the current supply for calculation. If mint_offset is true,
    the total_supply + mint_amount is used (it is used to calculate if a mint WOULD be allowed)
    
  */

  let {
    mints,
    mint_cap,
    mint_start,
    mint_end,
    mint_offset_start,
    mint_offset_end,
    rune_protocol_id,
    unmintable,
  } = Rune;

  if (unmintable) {
    return false;
  } //If the rune is unmintable, minting is globally not allowed

  let [creationBlock, creationTxIndex] = rune_protocol_id
    .split(":")
    .map((arg) => parseInt(arg));

  //Mints may be made in any transaction --after-- an etching, including in the same block.

  if (block === creationBlock && creationTxIndex === txIndex) return false;

  if (rune_protocol_id === "1:0") creationBlock = GENESIS_BLOCK;

  /*
        Setup variable defs according to ord spec,
    */

  //Convert offsets to real block heights
  mint_offset_start = (mint_offset_start ?? 0) + creationBlock;
  mint_offset_end = (mint_offset_end ?? 0) + creationBlock;

  /*

  mint_cap and premine are separate. See
    https://github.com/ordinals/ord/blob/6103de9780e0274cf5010f3865f0e34cb1564b58/src/index/entry.rs#L60
  line 95 
  
  for this reason when calculating if a Rune has reached its mint cap, we must first remove the premine from the total supply to get
  the actual runes generated from mints alone.
  */

  //This should always be perfectly divisible, since mint_amount is the only amount always added to the total supply
  total_mints = BigInt(mints) + (mint_offset ? 1n : 0n);

  //If the mint offset (amount being minted) causes the total supply to exceed the mint cap, this mint is not allowed

  //First check if a mint_cap was provided
  if (mint_cap) {
    //If a mint_cap is provided we can perform the check to see if minting is allowed
    if (total_mints >= BigInt(mint_cap)) return false;
  }

  //Define defaults used for calculations below
  const starts = [mint_start, mint_offset_start].filter(
    (e) => e !== creationBlock
  );
  const ends = [mint_end, mint_offset_end].filter((e) => e !== creationBlock);

  /*
        If both values differ from the creation block, it can be assumed that they were both provided during etching.
        In this case, we want to find the MAXIMUM value according to ord spec.

        See: https://github.com/ordinals/ord/blob/master/src/index/entry.rs LINE 112-146

        If only one value is provided, we use the one provided.

        If no values are provided, start is the creationBlock.

    */
  const start =
    starts.length === 2
      ? Math.max(mint_start ?? creationBlock, mint_offset_start)
      : starts[0] ?? creationBlock;

  /*

        Same as start with a few key differences: we use the MINIMUM value for the ends. If one is provided we use that one and if not are provided
        block is set to Infinity to allow minting to continue indefinitely.
    */

  const end =
    ends.length === 2
      ? Math.min(mint_end ?? mint_offset_end, mint_offset_end)
      : ends[0] ?? Infinity;

  //Perform comparisons

  return !(start > block || end < block);
};

module.exports = {
  getReservedName,
  isMintOpen,
  updateUnallocated,
  minimumLengthAtHeight,
  getCommitment,
  checkCommitment,
  getRunestonesInBlock,
};
