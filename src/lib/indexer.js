require("dotenv").config({ path: "../../.env" });

const { toBigInt, stripObject, log } = require("./utils");
const {
  isMintOpen,
  getReservedName,
  updateUnallocated,
  minimumLengthAtHeight,
  checkCommitment,
  getRunestonesInBlock,
} = require("./runeutils");

const { Op } = require("sequelize");

const { SpacedRune, Rune: OrdRune } = require("@ordjs/runestone");

const findTransactionOrCreate = async (Transaction, Account, storage) => {
  const { findOrCreate } = storage;

  const { runestone, hash, block, hex, vout, txIndex } = Transaction;

  let transaction = await findOrCreate("Transaction", Transaction.hash, {
    block_id: block,
    tx_index: txIndex,
    account_id: Account.id,
    value_sats:
      //Get all vout values and convert them to a big integer string
      vout
        .map((vout) => toBigInt(vout.value.toString(), 8))

        //Add big ints of all items to get sum
        .reduce((a, b) => BigInt(a) + BigInt(b), BigInt(0))

        //Convert back to string
        .toString(),
    hex,
    runestone: JSON.stringify(runestone),
    hash: hash,
  });

  return transaction;
};

const getUnallocatedRunesFromUtxos = (inputUtxos) => {
  /*
        Important: Rune Balances from this function are returned in big ints in the following format
        {
            [rune_protocol_id]: BigInt(amount)
        }

        rune_protocol_id => is the rune_id used by the Runes Protocol and is recognized, 
        different from rune_id which is used by the DB for indexing.
    */

  return (
    inputUtxos

      //Get allocated runes and store them in an array
      .reduce((acc, utxo) => {
        let RuneBalances = utxo.rune_balances
          ? Object.entries(JSON.parse(utxo.rune_balances))
          : [];

        //Sum up all Rune balances for each input UTXO
        RuneBalances.forEach((rune) => {
          const [rune_protocol_id, amount] = rune;
          acc[rune_protocol_id] =
            (acc[rune_protocol_id] ?? BigInt("0")) + BigInt(amount);
        });

        return acc;
      }, {})
  );
};

const createNewUtxoBodies = async (vout, Transaction, storage) => {
  const { findManyInFilter } = storage;

  const recipientAddresses = vout
    .map((utxo) => utxo.scriptPubKey.address)
    //remove the OP_RETURN
    .filter((address) => address);

  //Get all recipient addresses already in db and create a hash map
  const ignoreCreate = (
    await findManyInFilter("Account", recipientAddresses)
  ).reduce((Acc, account) => ({ ...Acc, [account.address]: account }), {});

  //Resolve promises and create a hash map of the new accounts
  const newAccounts = (await Promise.all(accountCreationPromises)).reduce(
    (Acc, account) => ({ ...Acc, [account.address]: account }),
    {}
  );

  //Finally concatenate the two account lists into voutAccounts for linkage to UTXOs
  const voutAccounts = { ...ignoreCreate, ...newAccounts };

  return vout.map((utxo, index) => {
    const voutAddress = utxo.scriptPubKey.address;

    return {
      /*
        SEE: https://docs.ordinals.com/runes.html#Burning
        "Runes may be burned by transferring them to an OP_RETURN output with an edict or pointer."

        This means that an OP_RETURN vout must be saved for processing edicts and unallocated runes,
        however mustnt be saved as a UTXO in the database as they are burnt.

        Therefore, we mark a utxo as an OP_RETURN by giving it an account id of 0
      */
      account_id: voutAddress ? voutAccounts[voutAddress].id : 0,
      address: voutAddress,
      transaction_id: Transaction.id,
      value_sats: toBigInt(utxo.value.toString(), 8).toString(),
      hash: Transaction.hash,
      vout_index: index,
      block: Transaction.block_id,
      rune_balances: {},
      block_spent: null,
    };
  });
};

const updateOrCreateBalancesWithUtxo = async (utxo, storage, direction) => {
  //removes op_returns
  if (!utxo.account_id) return;

  const { findManyInFilter, create, updateAttribute } = storage;

  const utxoRuneBalances = Object.entries(JSON.parse(utxo.rune_balances));

  const balanceFilter = utxoRuneBalances.map((runeBalance) => [
    { account_id: utxo.account_id },
    { rune_protocol_id: runeBalance[0] },
  ]);

  const existingBalanceEntries = await findManyInFilter(
    "Balance",
    balanceFilter
  );

  for (let entry of utxoRuneBalances) {
    const [rune_protocol_id, amount] = entry;

    let balanceFound = existingBalanceEntries.find(
      (Balance) =>
        Balance.rune_id === rune_protocol_id &&
        Balance.account_id === utxo.account_id
    );

    if (!balanceFound) {
      balanceFound = create("Balance", {
        rune_protocol_id: rune_protocol_id,
        account_id: utxo.account_id,
        address: utxo.address,
        balance: 0,
      });
    }

    const newBalance = (
      BigInt(balanceFound.balance) +
      BigInt(amount) * BigInt(direction)
    ).toString();

    await updateAttribute("Balance", balanceFound.id, "balance", newBalance);
  }

  return;
};

const processEdicts = async (
  UnallocatedRunes,
  pendingUtxos,
  Transaction,
  storage
) => {
  const { block, txIndex, runestone } = Transaction;
  const { findManyInFilter } = storage;

  let { edicts, pointer } = runestone;

  if (runestone.cenotaph) {
    //Transaction is a cenotaph, input runes are burnt.
    //https://docs.ordinals.com/runes/specification.html#Transferring
    return {};
  }

  let allocate = (utxo, runeId, amount) => {
    /*
        See: https://docs.ordinals.com/runes/specification.html#Trasnferring
        
        An edict with amount zero allocates all remaining units of rune id.
      
        If an edict would allocate more runes than are currently unallocated, the amount is reduced to the number of currently unallocated runes. In other words, the edict allocates all remaining unallocated units of rune id.


    */
    let unallocated = UnallocatedRunes[runeId];
    let withDefault =
      unallocated < amount || amount === 0 ? unallocated : amount;

    UnallocatedRunes[runeId] = (unallocated ?? BigInt(0)) - withDefault;

    utxo.rune_balances[runeId] =
      (utxo.rune_balances[runeId] ?? BigInt(0)) + withDefault;
  };

  //References are kept because filter does not clone the array
  let nonOpReturnOutputs = pendingUtxos.filter((utxo) => utxo.account_id !== 0);

  if (edicts) {
    const transactionRuneId = `${block}:${txIndex}`;

    //Replace all references of 0:0 with the actual rune id which we have stored on db (Transferring#5)
    edicts.forEach(
      (edict) => (edict.id = edict.id === "0:0" ? transactionRuneId : edict.id)
    );

    let edictFilter = edicts.map((edict) => edict.id);

    //Cache all runes that are currently in DB in a hashmap, if a rune doesnt exist edict will be ignored
    let existingRunes = (await findManyInFilter("Rune", edictFilter)).reduce(
      (acc, rune) => ({ ...acc, [rune.rune_protocol_id]: rune }),
      {}
    );

    for (let edictIndex in edicts) {
      let edict = edicts[edictIndex];
      //A runestone may contain any number of edicts, which are processed in sequence.
      if (!existingRunes[edict.id]) {
        //If the rune does not exist, the edict is ignored
        continue;
      }

      if (!UnallocatedRunes[edict.id]) {
        //If the rune is not in the unallocated runes, it is ignored
        continue;
      }

      if (edict.output === pendingUtxos.length) {
        if (edict.amount === "0") {
          /*
              An edict with amount zero and output equal to the number of transaction outputs divides all unallocated units of rune id between each non OP_RETURN output.
          */

          const amountOutputs = BigInt(nonOpReturnOutputs.length);
          //By default all txs have exactly one OP_RETURN, because they are needed for runestones. More than 1 OP_RETURN is considered non-standard and ignored by btc nodes.

          const amount = BigInt(UnallocatedRunes[edict.id]) / amountOutputs;
          const remainder = BigInt(UnallocatedRunes[edict.id]) % amountOutputs;

          const withRemainder = amount + BigInt(1);

          nonOpReturnOutputs.forEach((utxo, index) =>
            allocate(utxo, edict.id, index < remainder ? withRemainder : amount)
          );
        } else {
          //If an edict would allocate more runes than are currently unallocated, the amount is reduced to the number of currently unallocated runes. In other words, the edict allocates all remaining unallocated units of rune id.

          nonOpReturnOutputs.forEach((utxo) =>
            allocate(utxo, edict.id, BigInt(edict.amount))
          );
        }
        continue;
      }

      //Transferring directly to op_return is allowed
      allocate(pendingUtxos[edict.output], edict.id, BigInt(edict.amount));
    }
  }

  //Transfer remaining runes to the first non-opreturn output
  let pointerOutput = nonOpReturnOutputs[pointer ?? 0];

  //move Unallocated runes to pointer output
  Object.entries(UnallocatedRunes).forEach((allocationData) =>
    allocate(pointerOutput, allocationData[0], allocationData[1])
  );

  return;
};

const processMint = async (UnallocatedRunes, Transaction, storage) => {
  const { block, txIndex, runestone } = Transaction;
  const mint = runestone?.mint;

  const { findOne } = storage;

  if (!mint) {
    return UnallocatedRunes;
  }
  //We use the same  process used to calculate the Rune Id in the etch function if "0:0" is referred to
  const runeToMint = await findOne(
    "Rune",
    mint === "0:0" ? `${block}:${txIndex}` : mint
  );

  if (!runeToMint) {
    //The rune requested to be minted does not exist.
    return UnallocatedRunes;
  }

  if (isMintOpen(block, runeToMint, true)) {
    //Update new mints to count towards cap

    let newMints = (BigInt(runeToMint.mints) + BigInt(1)).toString();
    await updateAttribute(
      "Rune",
      runeToMint.rune_protocol_id,
      "mints",
      newMints
    );

    if (runestone.cenotaph) {
      //If the mint is a cenotaph, the minted amount is burnt
      return UnallocatedRunes;
    }

    return updateUnallocated(UnallocatedRunes, {
      rune_id: runeToMint.rune_protocol_id,
      amount: BigInt(runeToMint.mint_amount),
    });
  } else {
    //Minting is closed
    return UnallocatedRunes;
  }
};

const processEtching = async (UnallocatedRunes, Transaction, rpc, storage) => {
  const { block, txIndex, runestone } = Transaction;

  const etching = runestone?.etching;

  const { findOne, create } = storage;

  //If no etching, return the input allocations
  if (!runestone.etching) {
    return UnallocatedRunes;
  }

  //If rune name already taken, it is non standard, return the input allocations

  //Cenotaphs dont have any other etching properties other than their name
  //If not a cenotaph, check if a rune name was provided, and if not, generate one

  let runeName = runestone.cenotaph
    ? etching
    : etching.rune ?? getReservedName(block, txIndex);

  //Check for valid commitment before doing anything (incase non reserved name)

  if (minimumLengthAtHeight(block) > runeName.length) {
    return UnallocatedRunes;
  }

  let spacedRune;

  if (etching.spacers && !runestone.cenotaph) {
    spacedRune = new SpacedRune(OrdRune.fromString(runeName), etching.spacers);
  }

  const isRuneNameTaken = !!(await findOne("Rune", runeName, "raw_name"));

  if (isRuneNameTaken) {
    return UnallocatedRunes;
  }

  //This is processed last since it is the most computationally expensive call (we have to call RPC twice)
  const isReserved = !etching.rune;

  if (!isReserved) {
    const hasValidCommitment = await checkCommitment(
      runeName,
      Transaction,
      block,
      rpc
    );

    if (!hasValidCommitment) {
      return UnallocatedRunes;
    }
  }

  /*
    Runespec: Runes etched in a transaction with a cenotaph are set as unmintable.

    If the runestone decoded has the cenotaph flag set to true, the rune should be created with no allocationg created

    see unminable flag in rune model
  */

  const EtchedRune = create("Rune", {
    rune_protocol_id: `${block}:${txIndex}`,
    name: spacedRune ? spacedRune.name : runeName,
    raw_name: runeName,
    symbol: etching.symbol ?? "¤",
    spacers: etching.spacers ?? 0,

    //ORD describes no decimals being set as default 0
    decimals: etching.divisibility ?? 0,

    total_supply: etching.premine ?? "0",
    total_holders: 0, //This is updated on transfer edict
    mints: "0",
    premine: etching.premine ?? "0",

    /*

            ORD chooses the greater of the two values for mint start (height, offset)
            and the lesser of two values for mint_end (height, offset)

            See: https://github.com/ordinals/ord/blob/master/src/index/entry.rs LINE 112-146

            This is implemented in isMintOpen function
        */

    mint_cap: etching.terms?.cap ?? null, // null for no cap, otherwise the cap
    mint_amount: etching.terms?.amount ?? null,
    mint_start: etching.terms?.height?.[0] ?? null,
    mint_end: etching.terms?.height?.[1] ?? null,
    mint_offset_start: etching.terms?.offset?.[0] ?? null,
    mint_offset_end: etching.terms?.offset?.[1] ?? null,
    turbo: etching.turbo,

    //Unmintable is a flag internal to this indexer, and is set specifically for cenotaphs as per the rune spec (see above)
    unmintable: runestone.cenotaph ? 1 : 0,
  });

  //Add premine runes to input allocations

  if (runestone.cenotaph) {
    //No runes are premined if the tx is a cenotaph.
    return UnallocatedRunes;
  }

  return updateUnallocated(UnallocatedRunes, {
    rune_id: EtchedRune.rune_protocol_id,
    amount: BigInt(EtchedRune.premine),
  });
};

const processRunestone = async (Transaction, rpc, storage) => {
  const { vout, vin } = Transaction;

  //Ignore the coinbase transaction
  if (vin[0].coinbase) return;

  // const SpenderAccount = await _findAccountOrCreate(Transaction, db)

  const { findManyInFilter, updateAttribute, create } = storage;

  let UtxoFilter = vin.map((vin) => [
    { hash: vin.txid },
    { vout_index: vin.vout },
  ]);

  //Setup Transaction for processing

  //If the utxo is not in db it was made before GENESIS (840,000) anmd therefore does not contain runes
  let inputUtxos = await findManyInFilter("Utxo", UtxoFilter, true);

  let SpenderAccount = await findAccountOrCreate(
    inputUtxos[0]?.address ?? "GENESIS",
    storage
  );

  let UnallocatedRunes = getUnallocatedRunesFromUtxos(inputUtxos);
  //let MappedTransactions = await getParentTransactionsMapFromUtxos(UtxoFilter, db)

  //Create A New Transaction to store UTXOs
  let NewTransaction = await findTransactionOrCreate(
    Transaction,
    SpenderAccount,
    storage
  );

  let pendingUtxos = await createNewUtxoBodies(vout, NewTransaction, storage);

  //Delete UTXOs as they are being spent
  // => This should be processed at the end of the block, with filters concatenated.. await Utxo.deleteMany({hash: {$in: UtxoFilter}})

  //Reference of UnallocatedRunes and pendingUtxos is passed around in follwoing functions
  await processEtching(UnallocatedRunes, Transaction, rpc, storage);

  //Mints are processed next and added to the RuneAllocations, with caps being updated (and burnt in case of cenotaphs)

  await processMint(UnallocatedRunes, pendingUtxos, Transaction, storage);

  await processEdicts(UnallocatedRunes, pendingUtxos, Transaction, storage);

  //Update all input UTXOs as spent
  await Promise.all(
    inputUtxos.map((utxo) =>
      updateAttribute("Utxo", utxo.id, "block_spent", Transaction.block_id)
    )
  );

  //parse rune_balances for all pendingUtxos
  pendingUtxos.forEach((utxo) => {
    utxo.rune_balances = JSON.stringify(stripObject(utxo.rune_balances));
  });

  //Create all UTXOs and create a map of their ids (remove all OP_RETURN too as they are burnt)
  const newUtxos = pendingUtxos
    .map((utxo) => utxo.account_id && create("Utxo", utxo).id)
    .filter((id) => id);

  //Get all old UTXOs from spender account
  const oldUtxos = SpenderAccount.utxo_list
    ? JSON.parse(SpenderAccount.utxo_list)
    : [];

  //Update account

  if (SpenderAccount.id !== -1) {
    await updateAttribute(
      "Account",
      SpenderAccount.address,
      "utxo_list",
      JSON.stringify(oldUtxos.concat(newUtxos))
    );
  }

  //Finally update balance store with new Utxos
  for (let utxo of inputUtxos)
    await updateOrCreateBalancesWithUtxo(utxo, storage, -1);

  for (let utxo of pendingUtxos)
    await updateOrCreateBalancesWithUtxo(utxo, storage, 1);

  return;
};

const loadBlockIntoMemory = async (block, storage) => {
  const { loadManyIntoMemory } = storage;

  //Load all utxos in the block's vin into memory in one call
  await loadManyIntoMemory("Utxo", {
    hash: {
      [Op.in]: block.map((transaction) =>
        transaction.vin.map((utxo) => utxo.txid).filter((hash) => hash)
      ),
    },
  });

  //Load all runes that might be transferred into memory. This would be every Rune in a mint, edict or etch

  await loadManyIntoMemory("Rune", {
    [Op.or]: [
      //Load all rune ids in every mint and edict mapped by "rune_protocol_id"
      {
        rune_protocol_id: {
          [Op.in]: block
            .map((transaction) => [
              transaction.runestone.mint,
              transaction.runestone.edicts?.map((edict) => edict.id),
            ])
            .flat(Infinity)
            .filter((rune) => rune),
        },
      },
      //Load all runes with "etch" as they are mapped by raw_name
      {
        raw_name: {
          [Op.in]: block
            .map((transaction) => transaction.runestone.etching?.raw_name)
            .filter((raw_name) => raw_name),
        },
      },
    ],
  });
};

const processBlock = async (block, callRpc, storage) => {
  const blockData = await getRunestonesInBlock(block, callRpc);
  for (let TransactionIndex in blockData) {
    log("Processing Transaction: ", TransactionIndex + "/" + blockData.length);

    let Transaction = blockData[TransactionIndex];
    log("hash: " + Transaction.hash);

    await processRunestone(Transaction, callRpc, storage);
  }

  await storage.commitChanges();

  return;
};

module.exports = {
  processBlock,
};
