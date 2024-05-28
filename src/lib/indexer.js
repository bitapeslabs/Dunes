
const {
    fromBigInt,
    toBigInt,
    runes
} = require('./tools')

const { SpacedRune, Rune: OrdRune } = require( '@ordjs/runestone' );


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


    Apedexer has two protocol messages: "etch" and "transfer"

    burn and mint are replaced by Transfer events where
    'coinbase' is set as the input for a transfer_output in mints
    'coinbase' is set as the output for a transfer_output in burns

    transferOutputs are as follows: 
    {   
        txid: string,
        creator: address,
        value: string,
        rune_id: string,
        input: COINBASE | { address, utxo_id },
        output: COINBASE | { address, utxo_id }
    }

    etch bodies (SAME AS ORD SPEC WITH BLOCK AND INDEX) + has transfer output:
    {
        decimals: number,
        rune_id: string,
        premine: string,
        mint_limits: {
            amount,
            cap,
            start_block,
            end_block
        },
        spacers: number,
        symbol: string,
        transfer_output: transfer_output
    }

    transfer bodies:
    transfer_output

    final apedexer body:
    [{ type, body, prev_hash }, { type, body, prev_hash }]

    Then these are serialized into "blocks"
    block = {
        block: number,
        prev_hash: string,
        body: [{ type, body, prev_hash }]
        chain_state
    }

    prev_hash would be JSON.stringify(block)

    chain_state is a copy of all balances and rune balances at the end of the block
    {
        rune_id: {terms, balances: { address_balances, utxo_balances, coinbase_balance },
        rune_id: {terms, balances: { address_balances, utxo_balances, coinbase_balance }
    }


    This allows anyone building an indexer to check the prevHash of the next block to see if it matches what they have.
    If it does not match, they can check the chain state and rebuild the block from the last valid hash

    The final ledger looks like this:
    [
        block,
        block,
        block,
        block,
        block
    ]

    File is then saved as (.ape format because why tf not lmfao). Blocks are saved as individual files. You only need the last block to rebuild the entire ledger
    Ledger_FULL_blk840000.ape (3GiB) -> containts chain_state
    Ledger_LIGHT_blk840000.ape (1MiB) -> does not contain chain_state, just events for a block


    With the ledger file, anybody can rebuild the entire Runes State from whatever block they choose

*/


require('dotenv').config({ path: '../../.env' })
const { databaseConnection } = require('../database/createConnection')





//Conversions



const getAccount = async (address, db) => {
    const {
        Account
    } = db;

    let account = await Account.findOneOrCreate({address: address}, {
        address: address,
        utxo_list: '[]'
    })

    return account
}

const createTransaction = async (
    Transction,
    Account, 
    db
) => {

    /*

    Rune Balances:
    {
        rune_id,
        amount
    }
    */

    const {
        Transactions
    } = db;

    const {
        runestone,
        hash,
        block,
        hex
    } = Transaction;
    

    let transaction = await Transactions.findOneOrCreate({hash: Transaction.hash}, {
        block_id: block,
        address_id: Account.id,
        value_sats: (
            //Get all vout values and convert them to a big integer string
            vout.map(vout => toBigInt(vout.value, 8))

            //Add big ints of all items to get sum
            .reduce((a, b) => BigInt(a) + BigInt(b), BigInt(0))
            
            //Convert back to string0
            .toString()
        ),
        hex,
        runestone: JSON.stringify(runestone),
        hash: hash
    })

    return transaction
}

const findTransaction = async (hash, db) => {
    const {
        Transactions
    } = db;

    return await Transactions.findOne({hash: hash})
}

const processEtching = async (InputAllocations, Transaction, db) => {

    const {
        block, 
        hash,
        runestone
    } = Transaction;

    const {
        etching
    } = runestone

    const {
        Rune
    } = db;

    //If no etching, return the input allocations
    if(!runestone.etching){ return InputAllocations; }

    //If rune name already taken, it is non standard, return the input allocations
    if(await Rune.findOne({name: etching.rune.name})){ return InputAllocations; }
    
    let spacedRune;

    if(etching.spacers){ 
        spacedRune = new SpacedRune(Rune.fromString(etching.rune.name), etching.spacers);
    }
    
    await Rune.create({
        rune_protocol_id: '0:0',
        name: spacedRune ? spacedRune.toString() : etching.rune.name,
        raw_name: etching.rune.name,
        symbol: etching.symbol ?? '¤',
        spacers: etching.spacers ?? 0,
        total_supply: 0, //This is updated on transfer edict
        premine: etching.premine ?? 0,
        total_holders: 0,
        mint_cap: 0,
        mint_amount: 0,
        mint_start: 0,
        mint_end: 0,
        turbo: etching.turbo
    })

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
        Rune,
        Runestone: RunestoneModel,
        Transactions,
        Utxo
    } = db;

   // const SpenderAccount = await _getAccount(Transaction, db)

    let UtxoFilter = vin.map(vin => vin.txid)

    let InputUtxos = await Utxo.find({hash: {$in: UtxoFilter}})

    let RuneAllocations = (
        //Get all utxos that are being spent
        InputUtxos

        //Get allocated runes and store them in an array
        .reduce((acc, utxo) => {
            let RuneBalances = JSON.parse(utxo.rune_balances)

            RuneBalances.forEach(rune => {
                if(!acc[rune.rune_id]){ acc[rune.rune_id] = 0; }
                acc[rune.rune_id] += rune.amount
            })
            return acc
        }), {}
    )

    let SpenderAccount = await getAccount(InputUtxos[0].address)

    //Delete UTXOs as they are being spent
    await Utxo.deleteMany({hash: {$in: UtxoFilter}})

    let MappedTransactions = (await Transactions.findMany({hash: {$in: UtxoFilter}}))
    .reduce((acc, Transaction) => {
        acc[Transaction.hash] = Transaction
        return acc
    }, {})

    let newUtxos = vout.map((utxo, index) => {

        return {
            account: SpenderAccount.id,
            transaction_id: MappedTransactionsp[utxo.hash].id,
            value_sats: toBigInt(utxo.value, 8),
            hash: utxo.hash,   
            vout_index: index,
            rune_balances: {}
        }
    })


    //Process etches

    /*
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
    */
   RuneAllocations = await processEtching(RuneAllocations, Transaction, db)
    

    //These are processed at the end incase there are any burnt runes


    


    
        
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