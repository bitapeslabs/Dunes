
const { Runestone } = require( '@ordjs/runestone' );
const { stripValue, stripObject } = require('./helpers');


const DecipherRunestone = (txJson) => {

    try{
        return {
            ...stripObject(Runestone.decipher({
                output: txJson.vout.map(utxo => {

                    return {
                        script_pubkey: utxo.scriptPubKey.hex
                    }
                })
            })),
            cenotaph: false
        }
    }catch(e){

        //If no op_return, it's not a cenotaph as its transferred to first output
        //if op_return present and deciphering failed, it is a cenotaph. Input runes would be burnt.

        // !!0 = false
        return {
            cenotaph: !!txJson.vout.filter(utxo => utxo.scriptPubKey.asm.includes('OP_RETURN')).length
        }
    }


}

  
const getRunestonesInBlock = async (blockNumber, RpcClient) => {
    console.log(blockNumber)
    const block = await RpcClient.getVerboseBlock(blockNumber)
    const transactions = block.tx

    const runestones = transactions.reduce((acc, txJson) => {
        let runestone = DecipherRunestone(txJson)

        acc.push(
            {
                runestone: runestone, 
                hash: txJson.txid,
                vout: txJson.vout,
                vin: txJson.vin
            }
        )
        
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