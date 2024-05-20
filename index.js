const { Runestone } = require('runelib');
const { databaseConnection } = require('./src/database/createConnection');
const {
    decodeSome
} = require('./src/lib/helpers');
const { callRpc } = require('./src/lib/rpc_connection');

//Express setup
const bodyParser = require("body-parser")
const express = require('express')
const server = express()

let models;

server.use(process.env.IAP ,bodyParser.urlencoded({ extended: false }));
server.use(process.env.IAP, bodyParser.json());


server.use((req, res, next) => {
    req.models = models;
    req.callRpc = callRpc;

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