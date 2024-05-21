const express = require('express')
const router = express.Router();
const { getRunestonesInBlock } = require('../lib/btc')


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

router.get('/:id', async function(req, res){

    const {
        QuickRpcClient,
    } = req;

    const blockHeight = parseInt(req.params.id, 10);
        
    // Check if the conversion was successful
    if (isNaN(blockHeight) || blockHeight < 0) {
        return res.status(400).send({ error: 'Invalid block height' });
    }
    const transactions = await QuickRpcClient.getVerboseBlock(blockHeight)
   
    res.send(transactions)
})

module.exports = router;