/*

    Runestone in format:
    {
        isCenotaph: true,
        runestone: json
    }

*/

/*
{
  edicts: Vec<Edict>,
  etching: Option<Etching>,
  mint: Option<RuneId>,
  pointer: Option<u32>,
}

*/

/*

    How rundexer would work is first a Ledger is created for every rune like so:

    ledgerentry1 -> utxo TRANSFER utxo ->
    -> hash((prevhash) MINT utxo) ->
    -> hash((prevhash) utxo BURN) ->
    -> hash((utxo ETCH))

    transactions processed in order of block height
    the order of protocol messages then Echings, then Mints, then Transfers OR Burns
    edicts are processed then in order of Vout Index

    with cenotaph transfers being replaced with BURN


    AFTER ALL BLOCKS HAVE BEEN INDEXED AND LEDGERS HAVE BEEN CREATED -> THEN WE SIMULATE THE LEDGERS by creating/deleting utxos

    so:
    a transaction being processed =>
        First ledger entries are determined, and they are added to the db
        SyncToLedger is called which will simulate the ledger protocol messages by creating/deleting utxos and updating balances / rune balances / holders / etc

    The idea is that the Indexer can be fully built from the ledger, without needing to reindex the entire blockchain again. If a ledger is broken at some point
    all hashes after will be invalid since they are chained together, so the ledger can be rebuilt from the last valid hash by checking w/ other 
    runedexers.

    People wanting to create their own indexer can download a common ledger and build from that, or rebuild with their own bitcoin node. They can check for sync by
    checking the hases.

    hash(JSON.stringify([prevHash, 'etch', {}])) -> hash(JSON.stringify([prevHash, 'mint', {}])) -> hash(JSON.stringify([prevHash, 'transfer', {}])) -> hash(JSON.stringify([prevHash, 'burn', {}]))

    etches and mints NEED a transfer

    transferOutputs are as follows: 
    {   
        txid: string,
        utxo_in: string, (0:0)
        address_in: string; (ETCH and MINTS are 'COINBASE' for address_in)
        rune_id: string,
        value: string,
        utxo_out: string; (COINBASE for burn)
        address_out: string; (COINBASE for burn)
        raw: (raw utxo created)
    }

    etch bodies (SAME AS ORD SPEC WITH BLOCK AND INDEX) + has transfer output:
    {
        divisibility: number,
        rune: {
          value: string,
          name: string
        },
        spacers: number,
        symbol: string,
        terms: {
          "height": {

          },
          "offset": {

          },
          "amount": "",
          "cap": ""
        },
        "turbo": true,
        "premine": ""
        "block": ""
        "index": "",
        transfer_output: transfer_output
    }

    mint bodies: -> transferred to creation
    {
        rune_protocol_id: string,
        value: string,
        transfer_output: transfer_output
    }

    burn bodies: -> transferred to creation
    {
        rune_protocol_id: string,
        value: string,
        transfer_output: transfer_output
    
    }

    transfer bodies:
    transfer_output

*/


require('dotenv').config({ path: '../../.env' })
const { databaseConnection } = require('../database/createConnection')

function getReservedName(block, tx) {
    const baseValue = BigInt("6402364363415443603228541259936211926");
    const combinedValue = (BigInt(block) << 32n) | BigInt(tx);
    return baseValue + combinedValue;
  }

const _createUtxoWithRunes = async (Transaction, db) => {

}

const _burnRunes = async (Allocations, db) => {

}

const _getAccount = async (address, db) => {
    const {
        Account
    } = db;

    let account = await Account.findOneOrCreate({address: address}, {
        address: address,
        utxo_list: '[]'
    })

    return account
}

const processRunestone = async(Transaction, db) => {

    const {
        runestone,
        hash,
        vout,
        vin
    } = Transaction;

    const {
        Account,
        Balance,
        Runestone: RunestoneModel,
        Transactions,
        Utxo
    } = db;

    const SpenderAccount = await _getAccount(Transaction, db)

    let UtxoFilter = vin.map(vin => vin.txid)
    let EdictAllocations = (
        //Get all utxos that are being spent
        (await Utxo.findAll({hash: {$in: UtxoFilter}}))

        //Get allocated runes and store them in an array
        .map(utxo => JSON.parse(utxo.rune_balances))
    )


    //These are processed at the end incase there are any burnt runes


    //Delete UTXOs as they are being spent
    await Utxo.deleteMany({hash: {$in: UtxoFilter}})



    let newUtxos = vout.map((utxo, index) => {
        return {



    if(runestone.cenotaph){
        //Cenotaphs are burnt runes
        await _burnRunes(EdictAllocations, db)

        EdictAllocations = []
    }

    /*

        decimals embedded to prevent excessive database lookups for each rune

        runebalances:
        [
            {
                rune_local_id,
                rune_protocol_id,
                value
                decimals
            }
        ]   
    */

    console.log(InputUtxos[0].hash)
    
}

const test  = async () => {
    const db = await databaseConnection()

    processRunestone({
        "runestone": {
          "etching": {
            "divisibility": 2,
            "rune": {
              "value": "67090369340599840949",
              "name": "ZZZZZFEHUZZZZZ"
            },
            "spacers": 7967,
            "symbol": "ᚠ",
            "terms": {
              "height": {
    
              },
              "offset": {
    
              },
              "amount": "100",
              "cap": "1111111"
            },
            "turbo": true,
            "premine": "11000000000"
          },
          "edicts": [],
          "cenotaph": false
        },
        "hash": "2bb85f4b004be6da54f766c17c1e855187327112c231ef2ff35ebad0ea67c69e",
        "vout": [
          {
            "value": 17.97928002,
            "n": 0,
            "scriptPubKey": {
              "asm": "1 3b8b3ab1453eb47e2d4903b963776680e30863df3625d3e74292338ae7928da1",
              "desc": "rawtr(3b8b3ab1453eb47e2d4903b963776680e30863df3625d3e74292338ae7928da1)#tv35u9pg",
              "hex": "51203b8b3ab1453eb47e2d4903b963776680e30863df3625d3e74292338ae7928da1",
              "address": "bc1p8w9n4v298668ut2fqwukxamxsr3ssc7lxcja8e6zjgec4euj3ksswckxz6",
              "type": "witness_v1_taproot"
            }
          },
          {
            "value": 0,
            "n": 1,
            "scriptPubKey": {
              "asm": "OP_RETURN 13 020704b5e1d8e1c8eeb788a30705a02d039f3e01020680dc9afd2808c7e8430a64",
              "desc": "raw(6a5d21020704b5e1d8e1c8eeb788a30705a02d039f3e01020680dc9afd2808c7e8430a64)#d24em3lg",
              "hex": "6a5d21020704b5e1d8e1c8eeb788a30705a02d039f3e01020680dc9afd2808c7e8430a64",
              "type": "nulldata"
            }
          }
        ],
        "vin": [
          {
            "txid": "ec40eb2a00eb3ead495d8f12a95432ec292d4d56839733af3acaa01a94ccb97f",
            "vout": 0,
            "scriptSig": {
              "asm": "",
              "hex": ""
            },
            "txinwitness": [
              "924b2624416402a52ed7cf4eba6b2c535d2def8e649a74ed97aaca5ec54881ef3b34da68bb13d76d6b420e60297a9247cb081d1e59cb2c260b1509cff25d4b31",
              "204c04e894d5357840e324b24c959ca6a5082035f6ffae12f331202bc84bf4612eac0063036f7264010b2047f22ed15d3082f5e9a005864528e4f991ade841a9c5846e2c118425878b6be1010d09b530368c74df10a30368",
              "c04c04e894d5357840e324b24c959ca6a5082035f6ffae12f331202bc84bf4612e"
            ],
            "sequence": 0
          }
        ]
      }, db)
}

test()

module.exports = processRunestone;