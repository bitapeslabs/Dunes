const { databaseConnection } = require('./src/database/createConnection');
const {
    decodeSome
} = require('./src/lib/helpers');

const { decodeRawBlock } = require('./src/lib/btc');

//Express setup
const bodyParser = require("body-parser")
const express = require('express')
const server = express()
const { createRpcClient }  = require('./src/lib/rpcapi')


let models;

server.use(process.env.IAP ,bodyParser.urlencoded({ extended: false }));
server.use(process.env.IAP, bodyParser.json());


const RpcClient = createRpcClient({
    url: process.env.BTC_RPC_URL,
    username: process.env.BTC_RPC_USERNAME,
    password: process.env.BTC_RPC_PASSWORD
})

const QuickRpcClient = createRpcClient({
    url: process.env.FAST_BTC_RPC_URL,
    username: process.env.FAST_BTC_RPC_USERNAME,
    password: process.env.FAST_BTC_RPC_PASSWORD
})

server.use((req, res, next) => {
    req.models = models;
    req.RpcClient = RpcClient;
    req.QuickRpcClient = QuickRpcClient;

    next();
});

server.use(`${process.env.IAP}/blocks`, require('./src/routes/blocks'))


async function start(){
    
    models = await databaseConnection()
    

    //API SERVER
    server.listen(3000, (err) => {
        console.log('> Ready on http://localhost:3000')
    })





}

start();