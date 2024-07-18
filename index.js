//Express setup
const bodyParser = require("body-parser");
const express = require("express");
const server = express();

//Local dependencies
const { createRpcClient } = require("./src/lib/rpc");
const { log } = require("./src/lib/utils");
const { storage: newStorage } = require("./src/lib/storage");
const { GENESIS_BLOCK } = require("./src/lib/constants");
const { sleep } = require("./src/lib/utils");

const { processBlock } = require("./src/lib/indexer");
const callRpc = createRpcClient({
  url: process.env.FAST_BTC_RPC_URL,
});

const startRpc = async () => {
  server.use(process.env.IAP, bodyParser.urlencoded({ extended: false }));
  server.use(process.env.IAP, bodyParser.json());

  server.use((req, res, next) => {
    req.callRpc = callRpc;

    next();
  });

  server.use(`${process.env.IAP}/blocks`, require("./src/routes/blocks"));

  server.listen(3000, (err) => {
    log("RPC server running on port 3000");
  });
};

//handler defs
const startServer = async () => {
  //Setup express routes
  /*
      Connect to BTC rpc node, commands managed with rpcapi.js
    */

  /*
      Storage aggregator. During the processing of a block changes arent commited to DB until after every Banana has processed.
      This makes it so that if for whatever reason a block isnt finished processing, changes are rfeverted and we can
      start processing at the start of the block
    */
  const useSetup = process.argv.includes("--new");
  const useTest = process.argv.includes("--test");
  let storage = await newStorage(useSetup);

  const { Setting } = storage.db;

  /*
      If the --new flag is included, the DB will be force reset and block processing will start at genesis block
      if last_block_processed is 0, genesis block has not been processed
    */

  let lastBlockProcessed =
    parseInt(
      (
        await Setting.findOrCreate({
          where: { name: "last_block_processed" },
          defaults: { value: 0 },
        })
      )[0].value
    ) || GENESIS_BLOCK - 1;

  //Process blocks in range will process blocks start:(startBlock) to end:(endBlock)
  //startBlock and endBlock are inclusive (they are also processed)
  const processBlocksInRange = async (startBlock, endBlock) => {
    for (
      let currentBlock = startBlock;
      currentBlock <= endBlock;
      currentBlock++
    ) {
      //Run the indexers processBlock function
      await processBlock(currentBlock, callRpc, storage, useTest);

      //Update the current block in the DB
      log("Block finished processing!", "debug");
      await Setting.update(
        { value: currentBlock },
        { where: { name: "last_block_processed" } }
      );
    }
    return;
  };

  //Use test flag only processes the testblock.json file. This is used to test the indexer in controlled scenarios.
  if (useTest) {
    await processBlocksInRange(lastBlockProcessed + 1, lastBlockProcessed + 1);
    return;
  }

  /*
    Main server loop, syncnronize any time a new block is found or we are off by any amount of blocks
  */
  while (true) {
    let latestBlock = parseInt(await callRpc("getblockcount", []));
    log("latest block height is at " + latestBlock, "info");
    log("current block height is at " + lastBlockProcessed, "info");

    if (lastBlockProcessed < latestBlock)
      await processBlocksInRange(lastBlockProcessed + 1, latestBlock);
    await sleep(process.env.BLOCK_CHECK_INTERVAL);
  }
};

const start = async () => {
  if (process.argv.includes("--server")) startServer();
  if (process.argv.includes("--rpc")) startRpc();
};

start();
