
const getReservedName = (block, tx)  =>  {
    const baseValue = BigInt("6402364363415443603228541259936211926");
    const combinedValue = (BigInt(block) << 32n) | BigInt(tx);
    return baseValue + combinedValue;
}

const isMintOpen = (block, Rune) => {

    
    const {
        mint_cap,
        mint_start,
        mint_end,
        mint_offset_start,
        mint_offset_end,
        mint_amount,
        total_supply

    } = Rune;
    

    if(total_supply >= mint_cap){ return false; }

    const start = Math.max(mint_start, mint_offset_start)
    const end = Math.min(mint_end, mint_offset_end)

    if(start > block || end < block){ return false; }
    

    return true;
}

module.exports = {
    getReservedName,
    isMintOpen
}

