require("dotenv").config();
const axios = require("axios");
const { sleep } = require("./tools");

const createRpcClient = (rpcConfig) => {
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

  const callRpc = async (method, params = []) => {
    try {
      let startTime = Date.now();
      const response = await rpcClient.post("", {
        jsonrpc: "1.0",
        id: new Date().getTime(),
        method: method,
        params: params,
      });

      let processingTime = Date.now() - startTime;
      console.log(`RPC call ${method} took ${processingTime / 1000}s`);
      return response.data.result;
    } catch (error) {
      console.log(error.toJSON());
      //throw error;
    }
  };

  // ====================================

  const getVerboseBlock = async (blockNumber) => {
    try {
      let startTime = Date.now();
      const blockHash = await callRpc("getblockhash", [parseInt(blockNumber)]);
      console.log(`blockHash ${blockHash}`);
      const block = await callRpc("getblock", [blockHash, 2]);
      let processingTime = Date.now() - startTime;
      console.log(`verboseBlock call took ${processingTime / 1000}s`);
      return block;
    } catch (error) {
      console.log(error.toJSON());
    }
  };

  const getVerboseTransaction = async (txid) => {
    try {
      const tx = await callRpc("getrawtransaction", [txid, true]);
      return tx;
    } catch (error) {
      console.log(error.toJSON());
    }
  };

  const getBlockHeadersFromHash = async (blockHash) => {
    try {
      const block = await callRpc("getblockheader", [blockHash]);
      return block.height;
    } catch (error) {
      console.log(error.toJSON());
    }
  };

  return {
    callRpc,
    getVerboseBlock,
    getVerboseTransaction,
    getBlockHeadersFromHash,
  };
};

module.exports = {
  createRpcClient,
};
