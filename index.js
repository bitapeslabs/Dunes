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

//handler defs
const startServer = async () => {
  //Setup express routes
  server.use(process.env.IAP, bodyParser.urlencoded({ extended: false }));
  server.use(process.env.IAP, bodyParser.json());
  server.use(`${process.env.IAP}/blocks`, require("./src/routes/blocks"));

  server.listen(3000, (err) => {
    log("RPC server running on port 3000");
  });
  /*
      Connect to BTC rpc node, commands managed with rpcapi.js
    */
  const callRpc = createRpcClient({
    url: process.env.FAST_BTC_RPC_URL,
  });

  /*
      Storage aggregator. During the processing of a block changes arent commited to DB until after every Banana has processed.
      This makes it so that if for whatever reason a block isnt finished processing, changes are rfeverted and we can
      start processing at the start of the block
    */
  const useSetup = process.argv.includes("--new");

  const storage = await newStorage(useSetup);

  const { Setting } = storage.db;

  /*
      If the --new flag is included, the DB will be force reset and block processing will start at genesiis block
    */

  let currentBlock = parseInt(
    (
      await Setting.findOrCreate({
        where: { name: "current_block" },
        defaults: { value: GENESIS_BLOCK },
      })
    )[0].value
  );

  const processBlocksFromCurrent = async (endBlock) => {
    for (currentBlock; currentBlock <= endBlock; currentBlock++) {
      log("Processing block: ", currentBlock + "/" + endBlock);

      //Run the indexers processBlock function
      await processBlock(currentBlock, callRpc, storage);

      //Update the current block in the DB
      await Setting.update(
        { value: currentBlock },
        { where: { name: "current_block" } }
      );
    }
    return;
  };

  /*
    Main server loop, syncnronize any time a new block is found or we are off by any amount of blocks
  */
  while (true) {
    let latestBlock = parseInt(await callRpc("getblockcount", []));
    log("latest block height is at " + latestBlock, "info");
    log("current block height is at " + currentBlock, "info");

    if (currentBlock < latestBlock) await processBlocksFromCurrent(latestBlock);
    await sleep(process.env.BLOCK_CHECK_INTERVAL);
  }
};

const start = async () => {
  if (process.argv.includes("--server")) return startServer();
};

start();
