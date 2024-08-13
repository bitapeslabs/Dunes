const {
  GENESIS_BLOCK,
  UNLOCK_INTERVAL,
  INITIAL_AVAILABLE,
  TAPROOT_ANNEX_PREFIX,
  COMMIT_CONFIRMATIONS,
  TAPROOT_SCRIPT_PUBKEY_TYPE,
} = require("./constants");
const { storage: newStorage } = require("./storage");
const { Op } = require("sequelize");

const { Rune: OrdJSRune } = require("@ordjs/runestone");
const { Script } = require("@cmdcode/tapscript");
const { runestone } = require("@runeapes/apeutils");
const {
  log,
  convertAmountToParts,
  convertPartsToAmount,
  sleep,
  stripObject,
  chunkify,
} = require("./utils");
const NO_COMMITMENTS = process.argv.includes("--no-commitments");
const fs = require("fs");
const path = require("path");
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

  const transactionsWithRunestones = await Promise.all(
    transactions.map((tx, txIndex) => {
      return new Promise(async function (resolve, reject) {
        let runestone = decipherRunestone(tx);
        let sender = "GENESIS";
        const { vin: vins } = tx;

        // if coinbase dont populate sender or parentTx

        if (vins[0].txid) {
          if (runestone.etching?.rune && !NO_COMMITMENTS) {
            //populate vins with the block they were created at (only for etchings)
            tx.vin = await Promise.all(
              vins.map(async (vin) => {
                if (!vin.txid) return vin; //incase coinbase

                let parentTx = await callRpc("getrawtransaction", [
                  vin.txid,
                  true,
                ]);
                let parentTxBlock = await callRpc("getblockheader", [
                  parentTx.blockhash,
                ]);

                return {
                  ...vin,
                  parentTx: { ...parentTx, block: parentTxBlock.height },
                };
              })
            );
            sender = tx.vin[0].parentTx.vout[0].scriptPubKey.address ?? null;

            /*
          These two fields in a runestone have the ability to create new Runes out of nowehere, with no previous sender. The event should have
          as the sender the owner of the first vout in the transaction instead.
          */
          }
        }

        resolve({
          runestone: decipherRunestone(tx),
          hash: tx.txid,
          txIndex,
          block: blockNumber,
          vout: tx.vout,
          vin: tx.vin,
          sender,
        });
      });
    })
  );

  return transactionsWithRunestones;
};

const prefetchTransactions = async (block, storage, callRpc) => {
  const { create, findOrCreate } = storage;
  findOrCreate("Address", "COINBASE", { address: "COINBASE" }, true);
  findOrCreate("Address", "OP_RETURN", { address: "OP_RETURN" }, true);
  findOrCreate("Address", "UNALLOCATED", { address: "UNALLOCATED" }, true);
  const chunks = chunkify(block, 3);
  for (let chunk of chunks) {
    console.log(chunk);
    await Promise.all(
      chunk.map(async (blockNumber) => {
        const blockHash = await callRpc("getblockhash", [
          parseInt(blockNumber),
        ]);

        const block = await callRpc("getblock", [blockHash, 2]);

        block.tx.forEach((transaction) => {
          if (transaction.vin[0].coinbase) return;

          let Transaction = create("Transaction", {
            hash: transaction.txid,
          });

          transaction.vout.forEach((utxo, index) => {
            let address = utxo.scriptPubKey.address;
            if (!address) return; //OP_RETURN
            create("Utxo", {
              value_sats: parseInt(utxo.value * 10 ** 8).toString(),
              block: blockNumber,
              transaction_id: Transaction.id,
              address_id: findOrCreate("Address", address, { address }).id,
              vout_index: utxo.n,
            });
          });
        });

        return;
      })
    );
  }
  return;
};

const blockManager = async (callRpc, latestBlock) => {
  const readBlockStorage = await newStorage();

  let { MAX_BLOCK_CACHE_SIZE, GET_BLOCK_CHUNK_SIZE } = process.env;

  MAX_BLOCK_CACHE_SIZE = parseInt(MAX_BLOCK_CACHE_SIZE ?? 20);
  GET_BLOCK_CHUNK_SIZE = parseInt(GET_BLOCK_CHUNK_SIZE ?? 10);

  let cachedBlocks = {};

  let cacheFillProcessing = false;
  const __fillCache = async (requestedBlock) => {
    cacheFillProcessing = true;

    let lastBlockInCache = parseInt(Object.keys(cachedBlocks).slice(-1));
    let currentBlock = lastBlockInCache ? lastBlockInCache + 1 : requestedBlock;
    while (
      currentBlock <= latestBlock &&
      Object.keys(cachedBlocks).length < MAX_BLOCK_CACHE_SIZE
    ) {
      // Determine the chunk size to request in this iteration
      let chunkSize = Math.min(
        GET_BLOCK_CHUNK_SIZE,
        latestBlock - currentBlock + 1
      );

      // Create an array of Promises to fetch blocks in parallel
      let promises = [];
      for (let i = 0; i < chunkSize; i++) {
        promises.push(getRunestonesInBlock(currentBlock + i, callRpc));
      }

      // Wait for all Promises in the chunk to resolve
      let results = await Promise.all(promises);

      const { loadManyIntoMemory, findOne, local, clear, fetchGroupLocally } =
        readBlockStorage;

      const transactionsInChunk = [
        ...new Set(
          results
            .flat(Infinity)
            .map((tx) => tx.vin.map((vin) => vin.txid))
            .flat(Infinity)
            .filter(Boolean)
        ),
      ];

      //Load relevant vin into memory to avoid fetching from bitcoinrpc

      await loadManyIntoMemory("Transaction", {
        hash: { [Op.in]: transactionsInChunk },
      });

      await loadManyIntoMemory("Utxo", {
        transaction_id: {
          [Op.in]: Object.values(local.Transaction).map((tx) => tx.id),
        },
      });

      await loadManyIntoMemory("Address", {
        id: {
          [Op.in]: [
            ...new Set(
              Object.values(local.Utxo).map((utxo) => utxo.address_id)
            ),
          ],
        },
      });

      log(
        "(BC) Transactions loaded into memory: " +
          Object.keys(local.Transaction).length,
        "debug"
      );

      log(
        "(BC) UTXOS loaded into memory: " + Object.keys(local.Utxo).length,
        "debug"
      );

      log(
        "(BC) Addresses loaded into memory: " +
          Object.keys(local.Address).length,
        "debug"
      );

      // Hydrate txs with sender
      results = await Promise.all(
        results.map(async (block) => {
          return await Promise.all(
            block.map(async (tx) => {
              const { vin: vins, runestone } = tx;

              // if coinbase dont populate sender or parentTx
              if (vins[0].coinbase) {
                return { ...tx, sender: "COINBASE" };
              }

              //check if we already have the sender in the cache
              if (runestone.etching?.rune && !NO_COMMITMENTS) {
                let senderVin = vins.find(
                  (vin) => vin.parentTx.vout[vin.vout].scriptPubKey.address
                );
                return {
                  ...tx,
                  sender:
                    senderVin.parentTx.vout[senderVin.vout].scriptPubKey
                      .address,
                };
              }

              let transaction = findOne(
                "Transaction",
                vins[0].txid,
                false,
                true
              );

              //Check if the transaction hash has already been seen in db
              if (transaction) {
                let sender_id = fetchGroupLocally(
                  "Utxo",
                  "transaction_id",
                  transaction.id
                )?.[0]?.address_id;

                if (!sender_id) return { ...tx, sender: null };
                let sender = findOne("Address", sender_id + "@REF@id").address;
                return {
                  ...tx,
                  sender,
                };
              }

              //If none of the above conditions are met, we must fetch the sender from bitcoinrpc (if mint or etching)

              if (runestone?.mint || runestone?.etching) {
                let sender = (
                  await callRpc("getrawtransaction", [vins[0].txid, true])
                ).vout[vins[0].vout].scriptPubKey.address;

                return {
                  ...tx,
                  sender,
                };
              }

              //We dont need the sender for non-rune related txs
              return { ...tx, sender: null };
            })
          );
        })
      );

      clear();

      // Store the results in the cache
      for (let i = 0; i < results.length; i++) {
        let blockHeight = currentBlock + i;
        cachedBlocks[blockHeight] = results[i];
      }

      currentBlock += chunkSize;
      log(
        "Cache updated and now at size of " + Object.keys(cachedBlocks).length,
        "debug"
      );

      //-> to avoid getting rate limited
    }

    cacheFillProcessing = false;
  };
  const getBlock = (blockNumber, endBlock) => {
    return new Promise(function (resolve, reject) {
      let foundBlock;
      if (cachedBlocks[blockNumber]) {
        foundBlock = [...cachedBlocks[blockNumber]];
        delete cachedBlocks[blockNumber];
      }

      if (!cacheFillProcessing) {
        __fillCache(blockNumber);
      }

      if (foundBlock) return resolve(foundBlock);

      let checkInterval = setInterval(() => {
        if (cachedBlocks[blockNumber]) {
          foundBlock = [...cachedBlocks[blockNumber]];
          delete cachedBlocks[blockNumber];
          clearInterval(checkInterval);
          return resolve(foundBlock);
        }
      }, 10);
    });
  };

  return {
    getBlock,
  };
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

const checkCommitment = (runeName, Transaction, block, callRpc) => {
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
      const isTaproot =
        input.parentTx.vout[input.vout].scriptPubKey.type ===
        TAPROOT_SCRIPT_PUBKEY_TYPE;

      if (!isTaproot) {
        continue;
      }

      const confirmations = block - input.parentTx.block + 1;

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
  mint_offset_start =
    parseInt(mint_offset_start ?? 0) + parseInt(creationBlock);
  mint_offset_end = parseInt(mint_offset_end ?? 0) + parseInt(creationBlock);

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
    //If a mint_cap is provided we can perform the check to see if minting is allowed (minting is allowed on the cap itself)
    if (total_mints > BigInt(mint_cap)) return false;
  }

  //Define defaults used for calculations below
  const starts = [mint_start, mint_offset_start]
    .filter((e) => e !== creationBlock)
    .map((n) => parseInt(n));

  const ends = [mint_end, mint_offset_end]
    .filter((e) => e !== creationBlock)
    .map((n) => parseInt(n));

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
  blockManager,
  getRunestonesInBlock,
  convertPartsToAmount,
  convertAmountToParts,
  prefetchTransactions,
};
