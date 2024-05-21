
const { Runestone } = require('runelib');
const { stripValue, stripObject } = require('./helpers');



  
const getRunestonesInBlock = async (blockNumber, RpcClient) => {
    const transactions = (await RpcClient.getVerboseBlock(blockNumber))
    .tx;

    const runestones = transactions.reduce((acc, tx) => {
        let runestone;
        try{
            runestone = Runestone.decipher(tx.hex)
            
        }catch(e){
            console.log(e)
            //skip (cenotaph or not a runestone)
            return acc
        }
        runestone = stripObject(runestone)

        if(Object.values(runestone).length){
            runestone = stripValue(runestone)

            acc.push(
                {
                    runeStone: runestone, 
                    txHash: tx.txid, 
                    hasEdict: runestone.edicts.length > 0 ? "doeshaveedict" : "noedict",
                    txJson: tx
                }
            )
        }
        return acc

        
    }, [])

    return runestones;
}

module.exports = {
    getRunestonesInBlock
}


/*


edict types: mint / transfer / burn / etch

[
    {
        inputs: [
            {
                utxoid: txhash:id,
                owner: address,
                value: amount
                runeInfo: {
                    rune: rune,
                    runeValue: runeValue
                }

            }
        ],

        outputs: [
            {
                utxoid: txhash:id,
                owner: address,
                value: amount,
                lock: locktime blocks (if any),
                runeInfo: {
                    rune: rune,
                    runeValue: runeValue
                    edictType: edictType
                    runestoneJson
                },
                txHex
                txJson
            }
        ]
    }
]
*/