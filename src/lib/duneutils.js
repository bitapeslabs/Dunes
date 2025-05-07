const {
  GENESIS_BLOCK,
  UNLOCK_INTERVAL,
  INITIAL_AVAILABLE,
} = require("./constants");
const { Op } = require("sequelize");

const {
  log,
  convertAmountToParts,
  convertPartsToAmount,
  chunkify,
  btcToSats,
} = require("./utils");
const NO_COMMITMENTS = process.argv.includes("--no-commitments");
const dunestone = require("./dunestone");

const decipherDunestone = (txJson) => {
  return dunestone.decipher(txJson);
};

const isUsefulDuneTx = (Transaction) => {
  const { dunestone } = Transaction;
  if (dunestone?.cenotaph) return true; //burn happens

  if (dunestone?.mint || dunestone?.etching) return true;

  return false;
};

const getDunestonesInBlock = async (blockNumber, callRpc) => {
  const blockHash = await callRpc("getblockhash", [parseInt(blockNumber)]);

  const block = await callRpc("getblock", [blockHash, 2]);

  const transactions = block.tx;

  const transactionsWithDunestones = await Promise.all(
    transactions.map((tx, txIndex) => {
      return new Promise(async function (resolve, reject) {
        resolve({
          dunestone: decipherDunestone(tx),
          hash: tx.txid,
          txIndex,
          block: blockNumber,
          vout: tx.vout,
          vin: tx.vin,
          full_tx: tx,
        });
      });
    })
  );

  return transactionsWithDunestones;
};

const prefetchTransactions = async (block, storage, callRpc) => {
  const { create, findOrCreate } = storage;
  findOrCreate("Address", "COINBASE", { address: "COINBASE" }, true);
  findOrCreate("Address", "OP_RETURN", { address: "OP_RETURN" }, true);
  findOrCreate("Address", "UNKNOWN", { address: "UNKNOWN" }, true);
  const chunks = chunkify(
    block,
    parseInt(process.env.GET_BLOCK_CHUNK_SIZE ?? 3)
  );
  for (let chunk of chunks) {
    log("Prefetching blocks: " + Object.values(chunk).join(", "), "info");
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

const populateResultsWithPrevoutData = async (results, callRpc, storage) => {
  const { loadManyIntoMemory, findOne, local, clear, fetchGroupLocally } =
    storage;

  const transactionsInChunk = [
    ...new Set(
      results
        .flat(Infinity)

        //We can do this because the indexer can interpret the sender from what we have stored in db.
        .map((tx) => (isUsefulDuneTx(tx) ? tx.vin.map((vin) => vin.txid) : []))
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
        ...new Set(Object.values(local.Utxo).map((utxo) => utxo.address_id)),
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
    "(BC) Addresses loaded into memory: " + Object.keys(local.Address).length,
    "debug"
  );

  //Map all txs in chunk to their hashes to check for vins faster
  let txMapInChunk = results.flat(Infinity).reduce((acc, tx) => {
    acc[tx.hash] = tx;
    return acc;
  }, {});
  // Hydrate txs with sender

  //a little bit of fucking voodoo magic
  return await Promise.all(
    results.map(async (block) => {
      return await Promise.all(
        block.map(async (tx) => {
          const { vin: vins, dunestone } = tx;

          // if coinbase dont populate sender or parentTx
          if (vins[0].coinbase) {
            return { ...tx, sender: "COINBASE" };
          }
          if (dunestone.etching?.dune && !NO_COMMITMENTS) {
            //populate vins with the block they were created at (only for etchings)
            let newVins = await Promise.all(
              tx.vin.map(async (vin) => {
                if (!vin.txid) return vin; //incase coinbase

                let parentTx =
                  txMapInChunk[vin.txid]?.full_tx ??
                  (await callRpc("getrawtransaction", [vin.txid, true]));
                let parentTxBlock =
                  txMapInChunk[vin.txid]?.block ??
                  (await callRpc("getblockheader", [parentTx.blockhash]))
                    .height;

                return {
                  ...vin,
                  parentTx: { ...parentTx, block: parentTxBlock },
                };
              })
            );

            let senderVin = newVins.find(
              (vin) => vin.parentTx.vout[vin.vout].scriptPubKey.address
            );

            return {
              ...tx,
              vin: newVins,
              sender:
                senderVin.parentTx.vout[senderVin.vout].scriptPubKey.address,
            };

            /*
                These two fields in a dunestone have the ability to create new Dunes out of nowehere, with no previous sender. The event should have
                as the sender the owner of the first vout in the transaction instead.
                */
          }

          //Check if the tx is referenced in the chunk
          let chunkVin = vins.find((vin) => txMapInChunk[vin.txid]);

          if (chunkVin) {
            let chunkTx = txMapInChunk[chunkVin.txid];
            return {
              ...tx,
              sender: chunkTx.vout[chunkVin.vout].scriptPubKey.address,
            };
          }

          let transaction = vins
            .map((vin) => findOne("Transaction", vin.txid, false, true))
            .filter(Boolean)[0];

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

          if (dunestone?.mint || dunestone?.etching) {
            let sender = (
              await callRpc("getrawtransaction", [vins[0].txid, true])
            ).vout[vins[0].vout].scriptPubKey.address;

            return {
              ...tx,
              sender,
            };
          }

          //We dont need the sender for non-dune related txs
          return { ...tx, sender: null };
        })
      );
    })
  );
};

const blockManager = async (callRpc, latestBlock, readBlockStorage) => {
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
        promises.push(getDunestonesInBlock(currentBlock + i, callRpc));
      }

      // Wait for all Promises in the chunk to resolve
      let results = await Promise.all(promises);
      results = await populateResultsWithPrevoutData(
        results,
        callRpc,
        readBlockStorage
      );

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

const minimumLengthAtHeight = (block) => {
  const stepsPassed = Math.floor((block - GENESIS_BLOCK) / UNLOCK_INTERVAL);

  return INITIAL_AVAILABLE - stepsPassed;
};

const updateUnallocated = (prevUnallocatedDunes, Allocation) => {
  /*
    An "Allocation" looks like the following:
    {
        dune_id: string,
        amount: BigInt
    }
  */

  prevUnallocatedDunes[Allocation.dune_id] =
    BigInt(prevUnallocatedDunes[Allocation.dune_id] ?? "0") + Allocation.amount;
  return prevUnallocatedDunes;
};

const isMintOpen = (block, txIndex, Dune, mint_offset = false) => {
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
    dune_protocol_id,
    unmintable,
  } = Dune;

  if (unmintable) {
    return false;
  } //If the dune is unmintable, minting is globally not allowed

  let [creationBlock, creationTxIndex] = dune_protocol_id
    .split(":")
    .map((arg) => parseInt(arg));

  //Mints may be made in any transaction --after-- an etching, including in the same block.

  if (block === creationBlock && creationTxIndex === txIndex) return false;

  if (dune_protocol_id === "1:0") creationBlock = GENESIS_BLOCK;

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
  
  for this reason when calculating if a Dune has reached its mint cap, we must first remove the premine from the total supply to get
  the actual dunes generated from mints alone.
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

function isPriceTermsMet(dune, transaction) {
  const price = dune?.etching?.terms?.price;
  if (!price) return true; // no price terms → auto OK

  const { amount: required, pay_to } = price; // amount is already BigInt

  // all outputs paying exactly to `pay_to`
  const payOutputs = transaction.vout.filter(
    (v) => v.scriptPubKey?.address === pay_to
  );
  if (payOutputs.length === 0) return false; // no payment at all

  const paid = payOutputs.reduce((acc, v) => acc + btcToSats(v.value), 0n);

  return paid >= required; // must match *exactly*
}
module.exports = {
  updateUnallocated,
  isMintOpen,
  minimumLengthAtHeight,
  blockManager,
  getDunestonesInBlock,
  convertPartsToAmount,
  convertAmountToParts,
  prefetchTransactions,
  isUsefulDuneTx,
  isPriceTermsMet,
};
