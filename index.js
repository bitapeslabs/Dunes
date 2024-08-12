//Express setup
const bodyParser = require("body-parser");
const express = require("express");
const server = express();

//Local dependencies
const { createRpcClient } = require("./src/lib/btcrpc");
const { log } = require("./src/lib/utils");
const { storage: newStorage } = require("./src/lib/storage");
const { GENESIS_BLOCK } = require("./src/lib/constants");
const { sleep } = require("./src/lib/utils");
const { blockManager: createBlockManager } = require("./src/lib/runeutils");

const {
  databaseConnection: createConnection,
} = require("./src/database/createConnection");

const { processBlock, loadBlockIntoMemory } = require("./src/lib/indexer");
const { callRpc, callRpcBatch } = createRpcClient({
  url: process.env.BTC_RPC_URL,
  username: process.env.BTC_RPC_USERNAME,
  password: process.env.BTC_RPC_PASSWORD,
});

//For testing
const fs = require("fs");
const path = require("path");

const testblock = JSON.parse(
  fs.readFileSync(path.join(__dirname, "./dumps/testblock.json"), "utf8")
);

const startRpc = async () => {
  log("Connecting to db (rpc)...", "info");

  const db = await createConnection();
  log("Starting RPC server...", "info");

  server.use("/*", bodyParser.urlencoded({ extended: false }));
  server.use("/*", bodyParser.json());

  server.use((req, res, next) => {
    req.callRpc = callRpc;
    req.db = db;
    next();
  });

  //rpc endpoints
  server.use(`/runes/events`, require("./src/rpc/runes/routes/events"));
  server.use(`/runes/balances`, require("./src/rpc/runes/routes/balances"));

  server.listen(process.env.RPC_PORT, (err) => {
    log("RPC server running on port " + process.env.RPC_PORT, "info");
  });
};

//handler defs
const startServer = async () => {
  if (!global.gc) {
    log("Please include --expose-gc flag to run indexer", "error");
    return;
  }

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
    const { getBlock } = createBlockManager(callRpcBatch, endBlock);
    let currentBlock = startBlock;
    let chunkSize = parseInt(process.env.MAX_STORAGE_BLOCK_CACHE_SIZE ?? 10);
    while (currentBlock <= endBlock) {
      const blocksToFetch = new Array(chunkSize)
        .fill(0)
        .map((_, i) => currentBlock + i);

      const fetchBlocksFromArray = async (blocksToFetch) => {
        log("Fetching blocks: " + blocksToFetch.join(", "), "info");
        return await Promise.all(
          blocksToFetch.map((height) => getBlock(height))
        );
      };

      let blocks = useTest
        ? [testblock]
        : await fetchBlocksFromArray(blocksToFetch);

      log("Blocks fetched! ", "info");

      let blocksMapped = blocks.reduce((acc, block, i) => {
        acc[currentBlock + i] = block;

        return acc;
      }, {});

      /*
      const { blockHeight, blockData } = useTest
        ? { blockHeight: currentBlock, blockData: testblock }
        : //Attempt to load from cache and if not fetch from RPC
          await getBlock(currentBlock);
        */

      log(
        "Loading blocks into memory: " + Object.keys(blocksMapped).join(", "),
        "debug"
      );
      //Run the indexers processBlock function
      await Promise.all(
        blocks.map((block) => loadBlockIntoMemory(block, storage))
      );
      for (let i = 0; i < blocks.length; i++) {
        processBlock(
          {
            blockHeight: currentBlock,
            blockData: blocksMapped[currentBlock],
          },
          callRpc,
          storage,
          useTest
        );
        currentBlock += 1;
      }

      log(
        "Committing changes from blocks into memory: " +
          Object.keys(blocksMapped).join(", "),
        "info"
      );
      await storage.commitChanges();
      global.gc();
      //Update the current block in the DB
      log("Block chunk finished processing!", "info");
      await Setting.update(
        { value: currentBlock - 1 },
        { where: { name: "last_block_processed" } }
      );
    }
    lastBlockProcessed = endBlock;
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
  log(
    "Polling for new blocks... Last Processed: " + lastBlockProcessed,
    "info"
  );
  while (true) {
    let latestBlock = parseInt(await callRpc("getblockcount", []));

    if (lastBlockProcessed < latestBlock) {
      log(
        "Processing blocks " + (lastBlockProcessed + 1) + " - " + latestBlock,
        "info"
      );
      await processBlocksInRange(lastBlockProcessed + 1, latestBlock);
      log(
        "Polling for new blocks... Last Processed: " + lastBlockProcessed,
        "info"
      );
    }

    await sleep(parseInt(process.env.BLOCK_CHECK_INTERVAL));
  }
};

const start = async () => {
  if (process.argv.includes("--server")) startServer();
  if (process.argv.includes("--rpc")) startRpc();
};

start();
