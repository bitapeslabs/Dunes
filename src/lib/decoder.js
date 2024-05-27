/*

    DEPRECATED: way too slow
*/

require('dotenv').config({ path: '../../.env' });
const { spawn } = require('child_process');
const path = require('path');
const { Runestone } = require( '@ordjs/runestone' );
const { stripValue, stripObject } = require('./helpers');

let ORD_PATH = process.env.ORD_PATH ? 
            ( 
                process.env.ORD_PATH.startsWith('./') ? 
                path.join(__dirname, '../../', process.env.ORD_PATH) : 
                path.join(__dirname, process.env.ORD_PATH)
            ) 
            : 'ord';

let XXD_PATH = process.env.XXD_PATH ? 
( 
    process.env.XXD_PATH.startsWith('./') ? 
    path.join(__dirname, '../../', process.env.XXD_PATH) : 
    path.join(__dirname, process.env.XXD_PATH)
) 
: 'xxd';


console.log('debug decoder: using ord path =>', ORD_PATH);
console.log('debug decoder: using xxd path =>', XXD_PATH);

function hexToBinary(hexString) {
    // Remove any spaces or newlines if present
    hexString = hexString.replace(/\s+/g, '');
    
    // Convert hex string to buffer
    const binaryData = Buffer.from(hexString, 'hex');
    
    return binaryData;
}


const _callOrd = async (transactionHex) => {
    return new Promise(function(resolve, reject)  {
        const command = spawn(ORD_PATH, ['decode'], {stdout: 'pipe'});
        const binaryData = hexToBinary(transactionHex);

        command.stdin.write(binaryData);
        command.stdin.end();

        // Handle command output
        command.stdout.on('data', (data) => {
            resolve(`${data}`);
        });

        command.stderr.on('data', (data) => {
            resolve(`Error: ${data}`);
        });
        command.on('close', (code) => {
            console.log(`Command exited with code ${code}`);
        });

    })
}

const decipherRunestoneWithOrd = async (transactionHex) => {

    //too slow...

    const ordRes = await _callOrd(transactionHex)
    console.log(ordRes)
    //Invalid OpCode
    if(ordRes.startsWith('Error')){ return { cenotaph: true, reason: 'decode error' } }
    
    //An ordinals transaction but not a runestone -> treated as cenotaph
    
    let runestone;
    try{
        runestone = JSON.parse(ordRes).runestone
    }catch(e){
        return { cenotaph: true, reason: 'parse error' }
    }


    if(runestone?.Cenotaph){ return { cenotaph: true, reason: runestone?.Cenotaph?.flaw ?? 'unknown flaw' } }

    if(!runestone?.Runestone){ return { cenotaph: true, reason: 'no runestone' } }
    
    return {...runestone?.Runestone}

}
const decipherRunestoneWithOrdJS = (txJson) => {

    try{

        let toDecipher = {
            output: txJson.vout.map(utxo => {

                return {
                    script_pubkey: utxo.scriptPubKey.hex
                }
            })
        }

        return {
            

            ...stripObject(Runestone.decipher(toDecipher)),
            cenotaph: false
        }
    }catch(e){        //If no op_return, it's not a cenotaph as its transferred to first output
        //if op_return present and deciphering failed, it is a cenotaph. Input runes would be burnt.

        // !!0 = false
        return {
            cenotaph: !!txJson.vout.filter(utxo => utxo.scriptPubKey.asm.includes('OP_RETURN')).length
        }
    }


}

module.exports = {
    decipherRunestoneWithOrdJS,
    decipherRunestoneWithOrd
}