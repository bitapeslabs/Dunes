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
const callRpc = createRpcClient({
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
    const { getBlock } = createBlockManager(callRpc, endBlock);
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
        if (currentBlock + i === 840000) {
          block.push({
            runestone: {
              etching: {
                divisibility: 18,
                premine: "150000000000000000000000000",
                rune: "RUNEAPESSHARES",
                spacers: 128,
                symbol: "🍌",
                terms: {
                  amount: "1000000000000000000",
                  cap: "0",
                  height: [null, null],
                  offset: [null, null],
                },
                turbo: true,
              },
              mint: "1:0",
              cenotaph: false,
            },
            block: 840000,
            hash: "spyhash",
            txIndex: block.length,
            vout: [
              {
                value: 0.00341096,
                n: 0,
                scriptPubKey: {
                  asm: "1 3c5734d41a2662eb21f9d0a6607a32af1e2053825aaad37a4d7dd6bcd3f745e4",
                  desc: "rawtr(3c5734d41a2662eb21f9d0a6607a32af1e2053825aaad37a4d7dd6bcd3f745e4)#tksqther",
                  hex: "51203c5734d41a2662eb21f9d0a6607a32af1e2053825aaad37a4d7dd6bcd3f745e4",
                  address: "newguy2",
                  type: "witness_v1_taproot",
                },
              },
              {
                value: 0,
                n: 1,
                scriptPubKey: {
                  asm: "OP_RETURN 13 14b0a33314df041600",
                  desc: "raw(6a5d0914b0a33314df041600)#2gj638r3",
                  hex: "6a5d0914b0a33314df041600",
                  type: "nulldata",
                },
              },
            ],
            vin: [
              {
                txid: "d7a2932a00d7e56c5a1fb86c7e1e99a792477fd91058821df507bba5905cb60c",
                vout: 1,
                scriptSig: {
                  asm: "",
                  hex: "",
                },
                txinwitness: [
                  "0addb404bdf6e0f967e43a12a4d37aaca6c7b6df2a7a62330429bec794438bd384ed11bb3b4b8722b3c7722338fd62148cd81d7396a64285c7315f53f19d4a25",
                ],
                sequence: 4294967295,
              },
            ],
            hex: "none",
          });
        }
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
        await processBlock(
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
        "debug"
      );
      await storage.commitChanges();
      global.gc();
      //Update the current block in the DB
      log("Block chunk finished processing!", "debug");
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

    await sleep(process.env.BLOCK_CHECK_INTERVAL);
  }
};

const start = async () => {
  if (process.argv.includes("--server")) startServer();
  if (process.argv.includes("--rpc")) startRpc();
};

start();
