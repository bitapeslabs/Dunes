require('dotenv').config()
const axios = require('axios');
const {sleep} = require('./helpers')


const createRpcClient =  (rpcConfig) => {
    
    // ====== Create RPC client constructor ======
    const rpcClient = axios.create({
        baseURL: rpcConfig.url, // Replace with your node's URL and port
        auth: {
          username: rpcConfig.username,
          password: rpcConfig.password
        },
        headers: {
          'Content-Type': 'application/json'
        }
    });

    
    const callRpc = async (method, params = []) => {
        try {
        const response = await rpcClient.post('', {
            jsonrpc: '1.0',
            id: new Date().getTime(),
            method: method,
            params: params
        });
        return response.data.result;
        } catch (error) {
            console.log(error.toJSON())
            //throw error;
        }
    }

    // ====================================

    const getVerboseBlock = async (blockNumber) => {
        try {
            const blockHash = await callRpc('getblockhash', [parseInt(blockNumber)]);
            console.log(Date.now())
            const block = await callRpc('getblock', [blockHash, 2]);
            console.log(Date.now())
            return block;
        } catch (error) {
            console.log(error.toJSON())
        }
    }


    return {
        callRpc,
        getVerboseBlock
    
    }
}

module.exports = {
    createRpcClient
}