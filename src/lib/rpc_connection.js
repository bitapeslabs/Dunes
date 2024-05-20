require('dotenv').config()
const axios = require('axios');

const rpcClient = axios.create({
    baseURL: process.env.BTC_RPC_URL, // Replace with your node's URL and port
    auth: {
      username: process.env.BTC_RPC_USERNAME,
      password: process.env.BTC_RPC_PASSWORD
    },
    headers: {
      'Content-Type': 'application/json'
    }
});

async function callRpc(method, params = []) {
    try {
      const response = await rpcClient.post('', {
        jsonrpc: '1.0',
        id: new Date().getTime(),
        method: method,
        params: params
      });
      return response.data.result;
    } catch (error) {
      throw error;
    }
  }

  module.exports = {
    callRpc
  }