const express = require('express')
const router = express.Router();

router.get('/headers/:id', async function(req, res){

    const blockHeight = parseInt(req.params.id, 10);
        
    // Check if the conversion was successful
    if (isNaN(blockHeight) || blockHeight < 0) {
        return res.status(400).send({ error: 'Invalid block height' });
    }
    const blockHash = await req.callRpc('getblockhash', [blockHeight])
    const blockHeaders = await req.callRpc('getblockheader', [blockHash])
    res.send(blockHeaders)
})

module.exports = router;