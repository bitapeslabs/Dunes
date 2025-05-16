//These were scratched because of various different reasons, but ill leave them here incase needed for future reference

/*

    APEBOOK FORMAT SPEC


    Mezcalstone in format:
    {
        isCenotaph: true,
        mezcalstone: json
    }

*/

/*
{
  edicts: Vec<Edict>,
  etching: Option<Etching>,
  mint: Option<MezcalId>,
  pointer: Option<u32>,
}

*/

/*

    How rundexer would work is first a Ledger is created for every mezcal like so:

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
        SyncToLedger is called which will simulate the ledger protocol messages by creating/deleting utxos and updating balances / mezcal balances / holders / etc

    The idea is that the Indexer can be fully built from the ledger, without needing to reindex the entire blockchain again. If a ledger is broken at some point
    all hashes after will be invalid since they are chained together, so the ledger can be rebuilt from the last valid hash by checking w/ other 
    mezcaldexers.

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
        mezcal_id: string,
        input: COINBASE | { address, utxo_id },
        output: COINBASE | { address, utxo_id }
    }

    etch bodies (SAME AS ORD SPEC WITH BLOCK AND INDEX) + has transfer output:
    {
        decimals: number,
        mezcal_id: string,
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

    chain_state is a copy of all balances and mezcal balances at the end of the block
    {
        mezcal_id: {terms, balances: { address_balances, utxo_balances, coinbase_balance },
        mezcal_id: {terms, balances: { address_balances, utxo_balances, coinbase_balance }
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


    With the ledger file, anybody can rebuild the entire Mezcals State from whatever block they choose

*/
