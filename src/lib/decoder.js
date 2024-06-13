require('dotenv').config({ path: '../../.env' });
const { runestone } = require( '@runeapes/apeutils' );
const { stripObject } = require('./helpers');

const decipherRunestone = (txJson) => {

    return {
        

        ...stripObject(runestone.decipher(txJson.hex) ?? {}),
        cenotaph: !!txJson.vout.filter(utxo => utxo.scriptPubKey.asm.includes('OP_RETURN')).length
    }

}

module.exports = {
    decipherRunestone
}