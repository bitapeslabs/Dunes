require("dotenv").config();
const { log } = require("./utils");
const axios = require("axios");

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
      log(`RPC call ${method} took ${processingTime / 1000}s`);
      return response.data.result;
    } catch (error) {
      log(error.toJSON());
    }
  };

  return callRpc;
};

module.exports = {
  createRpcClient,
};
