require("dotenv").config();
const { log } = require("./utils");
const axios = require("axios");
const { chunkify } = require("./utils");

const createRpcClient = (rpcConfig) => {
  let rpcQueue = [];
  let rpcResults = {};

  // ====== Create RPC client constructor ======
  const rpcClient = axios.create({
    baseURL: rpcConfig.url, // Replace with your node's URL and port
    auth: {
      username: rpcConfig.username,
      password: rpcConfig.password,
    },
    headers: {
      "Content-Type": "application/json",
    },
  });

  const queueRpcCallAndGetResult = (request) => {
    let queueId = rpcQueue.length + ":" + Date.now();

    rpcQueue.push({ req: request, id: queueId });
    rpcResults[queueId] = {};

    //This
    return new Promise(async (resolve, reject) => {
      let interval = setInterval(() => {
        if (Object.keys(rpcResults[queueId]).length > 0) {
          resolve({ ...rpcResults[queueId] });
          delete rpcResults[queueId];
          clearInterval(interval);
        }
      }, 10);
    });
  };
  const callRpc = async (method, params = []) => {
    try {
      let startTime = Date.now();
      const response = await rpcClient.post("", {
        jsonrpc: "1.0",
        id: new Date().getTime(),
        method: method,
        params: params,
      });

      //let processingTime = Date.now() - startTime;
      //log(`RPC call ${method} took ${processingTime / 1000}s`, "debug");
      return response.data.result;
    } catch (error) {
      log(error + " on " + method, "panic");
      throw error;
    }
  };
  const callRpcBatch = async (method, params = []) => {
    try {
      let startTime = Date.now();

      const response = await queueRpcCallAndGetResult({
        jsonrpc: "1.0",
        id: new Date().getTime(),
        method: method,
        params: params,
      });
      /*
      const response = await rpcClient.post("", {
        jsonrpc: "1.0",
        id: new Date().getTime(),
        method: method,
        params: params,
      });
        */
      let processingTime = Date.now() - startTime;
      //log(`RPC call ${method} took ${processingTime / 1000}s`, "debug");
      return response.result;
    } catch (error) {
      log(error + " on " + method, "panic");
      throw error;
    }
  };

  setInterval(async () => {
    if (!rpcQueue.length) return;
    //clone to queueSnapshot and clear rpcQueue
    let queueSnapshot = [...rpcQueue];
    rpcQueue = [];

    try {
      //process the batch
      let batch = queueSnapshot.map((request, index) => request.req);

      //We want to throttle large batch sizes to avoid crashing the Bitcoin RPC
      const maxBatchSize = parseInt(process.env.RPC_MAX_BATCH_SIZE ?? 1000);
      const chunks = chunkify(chunkify(batch, maxBatchSize), 3);

      let batchResult = [];
      for (let batchesInChunk of chunks) {
        log(
          "Processing batch of " + batchesInChunk.length + " requests for RPC",
          "debug"
        );
        let result = (
          await Promise.all(
            batchesInChunk.map((batch) => rpcClient.post("", batch))
          )
        )
          .map((result) => result?.data)
          .flat(Infinity)
          .filter(Boolean);
        batchResult.push(result);
        log("Batch processed for " + chunk.length + " requests", "debug");
      }

      batchResult = batchResult.flat(Infinity);
      queueSnapshot.forEach((request, index) => {
        rpcResults[request.id] = batchResult[index];
      });
    } catch (error) {
      log(error + " on batch", "panic");
      throw error;
    }
  }, parseInt(process.env.RPC_BATCH_INTERVAL ?? 100));

  return {
    callRpc,
    callRpcBatch,
  };
};

module.exports = {
  createRpcClient,
};
