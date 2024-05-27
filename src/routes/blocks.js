const express = require('express')
const router = express.Router();
const { getRunestonesInBlock } = require('../lib/btc')
const fs = require('fs')

router.get('/headers/:id', async function(req, res){


    const {
        RpcClient
    } = req;



    const blockHeight = parseInt(req.params.id, 10);
        
    // Check if the conversion was successful
    if (isNaN(blockHeight) || blockHeight < 0) {
        return res.status(400).send({ error: 'Invalid block height' });
    }
    const blockHash = await RpcClient.callRpc('getblockhash', [blockHeight])
    const blockHeaders = await RpcClient.callRpc('getblockheader', [blockHash])
    res.send(blockHeaders)
})


router.get('/runestones/:id', async function(req, res){
    const {
        QuickRpcClient,
    } = req;
    const blockHeight = parseInt(req.params.id, 10);

    if (isNaN(blockHeight) || blockHeight < 0) {
        return res.status(400).send({ error: 'Invalid block height' });
    }

    const runestones = await getRunestonesInBlock(req.params.id, QuickRpcClient)
    res.send(runestones)

})

router.get('/tx/:id', async function(req, res){
    
        const {
            QuickRpcClient,
        } = req;
    
        const txHash = req.params.id;
        const tx = await QuickRpcClient.callRpc('getrawtransaction', [txHash, false])
        res.send(tx)
})

router.get('/:id', async function(req, res){

    const {
        RpcClient,
    } = req;

    const blockHeight = parseInt(req.params.id, 10);
        
    // Check if the conversion was successful
    if (isNaN(blockHeight) || blockHeight < 0) {
        return res.status(400).send({ error: 'Invalid block height' });
    }
    const transactions = await RpcClient.getVerboseBlock(blockHeight)
    fs.writeFileSync('block_' + blockHeight + '.json', JSON.stringify(transactions, null, 2))
    res.send(transactions)
})

module.exports = router;