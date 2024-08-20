//Express setup
const bodyParser = require("body-parser");
const express = require("express");
const server = express();
const axios = require("axios");

//Local dependencies
const { createRpcClient } = require("./src/lib/btcrpc");
const { log } = require("./src/lib/utils");
const { storage: newStorage } = require("./src/lib/storage");
const { GENESIS_BLOCK } = require("./src/lib/constants");
const { sleep } = require("./src/lib/utils");
const {
  blockManager: createBlockManager,
  prefetchTransactions,
} = require("./src/lib/runeutils");

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

const emitToDiscord = async (events) => {
  if (!process.env.DISCORD_WEBHOOK) return;
  let etchings = events
    .filter((event) => event.type === 0)
    .filter((_, i) => i <= 5);
  for (let etch of etchings) {
    try {
      const embed = {
        title: "New etching!",
        description: "The rune " + etch.rune.name + " has been etched!",
        color: 0xffa500, // Color in hexadecimal
        fields: Object.keys(etch.rune)
          .filter((_, i) => i <= 10)
          .map((fieldName) => ({
            name: fieldName,
            value: etch.rune[fieldName],
            inline: true,
          })),
        timestamp: new Date(),
      };
      const payload = {
        embeds: [embed],
      };

      await axios.post(process.env.DISCORD_WEBHOOK, payload);
      await sleep(200);
    } catch (e) {
      //silently fail
    }
  }
  return;
};

const emitEvents = async (storage) => {
  const { local, findOne } = storage;
  let populatedEvents = [
    ...Object.values(local.Event).map((event) => ({
      id: event.id,
      type: event.type,
      block: event.block,
      transaction: findOne(
        "Transaction",
        event.transaction_id + "@REF@id",
        false,
        true
      ),
      rune: findOne("Rune", event.rune_id + "@REF@id", false, true),
      amount: event.amount,
      from: findOne("Address", event.from_address_id + "@REF@id", false, true),
      to: findOne("Address", event.to_address_id + "@REF@id", false, true),
    })),
  ];

  //For testing, in production this would be sent to a webhook or on an exposed WS
  emitToDiscord(populatedEvents);
  return;
};

const startRpc = async () => {
  log("Connecting to db (rpc)...", "info");

  const db = await createConnection();
  log("Starting RPC server...", "info");

  server.use("/*", bodyParser.urlencoded({ extended: false }));
  server.use("/*", bodyParser.json());

  server.use((req, res, next) => {
    req.callRpc = callRpc;
    req.db = db;

    if (
      req.headers.authorization !== process.env.RPC_AUTH &&
      process.env.RPC_AUTH
    ) {
      res.status(401).send("Unauthorized");
      return;
    }

    next();
  });

  //rpc endpoints
  server.use(`/runes/events`, require("./src/rpc/runes/routes/events"));
  server.use(`/runes/balances`, require("./src/rpc/runes/routes/balances"));
  server.use(`/runes/rpc`, require("./src/rpc/runes/routes/rpc"));

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

  let prefetchDone = parseInt(
    (
      await Setting.findOrCreate({
        where: { name: "prefetch" },
        defaults: { value: 0 },
      })
    )[0].value
  );
  const readBlockStorage = await newStorage();

  //Process blocks in range will process blocks start:(startBlock) to end:(endBlock)
  //startBlock and endBlock are inclusive (they are also processed)
  const processBlocksInRange = async (startBlock, endBlock) => {
    const { getBlock } = await createBlockManager(
      callRpcBatch,
      endBlock,
      readBlockStorage
    );
    let currentBlock = startBlock;
    let chunkSize = parseInt(process.env.MAX_STORAGE_BLOCK_CACHE_SIZE ?? 10);
    while (currentBlock <= endBlock) {
      const offset = currentBlock + chunkSize - endBlock - 1;

      const blocksToFetch = new Array(chunkSize - (offset > 0 ? offset : 0))
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
        "info"
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
        "Committing changes from blocks into db and emitting events: " +
          Object.keys(blocksMapped).join(", "),
        "info"
      );

      await emitEvents(storage);
      await storage.commitChanges();
      //Update the current block in the DB
      log("Block chunk finished processing!", "info");
      await Setting.update(
        { value: currentBlock - 1 },
        { where: { name: "last_block_processed" } }
      );
    }
    lastBlockProcessed = currentBlock;

    return;
  };

  //Use test flag only processes the testblock.json file. This is used to test the indexer in controlled scenarios.
  if (useTest) {
    await processBlocksInRange(lastBlockProcessed + 1, lastBlockProcessed + 1);
    return;
  }

  if (!prefetchDone) {
    let amountPrefetch = parseInt(process.env.PREFETCH_BLOCKS ?? 100);
    log(
      "Prefetching previous " +
        amountPrefetch +
        " blocks before genesis for fast indexing... (this can take a few minutes)",
      "info"
    );
    const blocksToFetch = new Array(amountPrefetch)
      .fill(0)
      .map((_, i) => lastBlockProcessed + i + 1 - amountPrefetch);
    await prefetchTransactions(blocksToFetch, storage, callRpcBatch);
    await storage.commitChanges();
    log("Prefetching complete!", "info");

    await Setting.update({ value: 1 }, { where: { name: "prefetch" } });
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
