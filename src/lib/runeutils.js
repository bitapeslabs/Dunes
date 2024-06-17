const getReservedName = (block, tx) => {
  const baseValue = BigInt("6402364363415443603228541259936211926");
  const combinedValue = (BigInt(block) << 32n) | BigInt(tx);
  return baseValue + combinedValue;
};

const updateAllocations = (prevAllocations, Allocation) => {
  /*
    An "Allocation" looks like the following:
    {
        rune_id: string,
        amount: BigInt
    }
  */

  prevAllocations[Allocation.rune_id] =
    BigInt(prevAllocations[Allocation.rune_id] ?? "0") + Allocation.amount;
  return prevAllocations;
};

const isMintOpen = (block, Rune, mint_offset = false) => {
  /*
    if mint_offset is false, this function uses the current supply for calculation. If mint_offset is true,
    the total_supply + mint_amount is used (it is used to calculate if a mint WOULD be allowed)
  */

  let {
    mints,
    mint_cap,
    mint_start,
    mint_end,
    mint_amount,
    mint_offset_start,
    mint_offset_end,
    rune_protocol_id,
    unmintable,
  } = Rune;

  if (unmintable) {
    return false;
  } //If the rune is unmintable, minting is globally not allowed

  let [creationBlock] = rune_protocol_id.split(":").map(parseInt);

  /*
        Setup variable defs according to ord spec,
    */

  mint_cap = BigInt(mint_cap) ?? BigInt(0); //If no mint cap is provided, minting is by default closed so we default to 0 which will negate any comparisons

  //Convert offsets to real block heights
  mint_offset_start = (mint_offset_start ?? 0) + creationBlock;
  mint_offset_end = (mint_offset_end ?? 0) + creationBlock;

  /*

  mint_cap and premine are separate. See
    https://github.com/ordinals/ord/blob/6103de9780e0274cf5010f3865f0e34cb1564b58/src/index/entry.rs#L60
  line 95 
  
  for this reason when calculating if a Rune has reached its mint cap, we must first remove the premine from the total supply to get
  the actual runes generated from mints alone.
  */

  //This should always be perfectly divisible, since mint_amount is the only amount always added to the total supply
  total_mints = BigInt(mints) + BigInt(mint_offset ? mint_amount : "0");

  //If the mint offset (amount being minted) causes the total supply to exceed the mint cap, this mint is not allowed
  if (total_mints >= mint_cap) {
    return false;
  }

  //Define defaults used for calculations below
  const starts = [mint_start, mint_offset_start].filter(
    (e) => e !== creationBlock
  );
  const ends = [mint_end, mint_offset_end].filter((e) => e !== creationBlock);

  /*
        If both values differ from the creation block, it can be assumed that they were both provided during etching.
        In this case, we want to find the MAXIMUM value according to ord spec.

        See: https://github.com/ordinals/ord/blob/master/src/index/entry.rs LINE 112-146

        If only one value is provided, we use the one provided.

        If no values are provided, start is the creationBlock.

    */
  const start =
    starts.length === 2
      ? Math.max(mint_start ?? creationBlock, mint_offset_start)
      : starts[0] ?? creationBlock;

  /*

        Same as start with a few key differences: we use the MINIMUM value for the ends. If one is provided we use that one and if not are provided
        block is set to Infinity to allow minting to continue indefinitely.
    */

  const end =
    ends.length === 2
      ? Math.min(mint_end ?? mint_offset_end, mint_offset_end)
      : ends[0] ?? Infinity;

  //Perform comparisons

  return !(start > block || end < block);
};

module.exports = {
  getReservedName,
  isMintOpen,
  updateAllocations,
};
