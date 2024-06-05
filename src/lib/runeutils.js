
const getReservedName = (block, tx)  =>  {
    const baseValue = BigInt("6402364363415443603228541259936211926");
    const combinedValue = (BigInt(block) << 32n) | BigInt(tx);
    return baseValue + combinedValue;
}

const isMintOpen = (
    
    block,
    Rune, 
    mint_offset = BigInt(0)

) => {

    /*
        Mint offset is given as a BigInt, it is a function used to check if minting would be allowed if x
        amount of Rune was minted
    */

    let {
        mint_cap,
        mint_start,
        mint_end,
        mint_offset_start,
        mint_offset_end,
        total_supply,
        rune_protocol_id

    } = Rune;
    
    let [
        creationBlock, 
    ] = rune_protocol_id.split(':').map(parseInt)
 
    /*
        Setup variable defs according to ord spec,
    */

    mint_cap = BigInt(mint_cap) ?? BigInt(0) //If no mint cap is provided, minting is by default closed so we default to 0 which will negate any comparisons
    
    //Convert offsets to real block heights
    mint_offset_start = (mint_offset_start ?? 0) + creationBlock
    mint_offset_end = (mint_offset_end ?? 0) + creationBlock

    //If the mint offset (amount being minted) causes the total supply to exceed the mint cap, this mint is not allowed
    if((BigInt(total_supply) + mint_offset) >= mint_cap){ return false; }
    
    //Define defaults used for calculations below
    const starts = [mint_start, mint_offset_start].filter(e => e !== creationBlock)
    const ends = [mint_end, mint_offset_end].filter(e => e !== creationBlock)


    /*
        If both values differ from the creation block, it can be assumed that they were both provided during etching.
        In this case, we want to find the MAXIMUM value according to ord spec.

        See: https://github.com/ordinals/ord/blob/master/src/index/entry.rs LINE 112-146

        If only one value is provided, we use the one provided.

        If no values are provided, start is the creationBlock.

    */
    const start = (starts.length === 2) ? Math.max(
        (mint_start ?? creationBlock),
        mint_offset_start
    ) : (starts[0] ?? creationBlock)
   

    /*

        Same as start with a few key differences: we use the MINIMUM value for the ends. If one is provided we use that one and if not are provided
        block is set to Infinity to allow minting to continue indefinitely.
    */

    const end = (ends.length === 2) ? Math.min(
        (mint_end ?? mint_offset_end),
        mint_offset_end 
    ) : (ends[0] ?? Infinity)


    console.log(start)
    console.log(end)


    //Perform comparisons    

    return !(start > block || end < block);
}

module.exports = {
    getReservedName,
    isMintOpen
}

