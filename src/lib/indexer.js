require("dotenv").config({ path: "../../.env" });

const { toBigInt, stripObject, log, sleep } = require("./utils");
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
const { GENESIS_BLOCK, GENESIS_RUNESTONE } = require("./constants");

//For testing
const fs = require("fs");
const path = require("path");

const testblock = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../dumps/testblock.json"), "utf8")
);

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

const createNewUtxoBodies = (vout, Transaction) => {
  return vout.map((utxo, index) => {
    const voutAddress = utxo.scriptPubKey.address;

    return {
      utxo_index: Transaction.hash + ":" + index,
      /*
        SEE: https://docs.ordinals.com/runes.html#Burning
        "Runes may be burned by transferring them to an OP_RETURN output with an edict or pointer."

        This means that an OP_RETURN vout must be saved for processing edicts and unallocated runes,
        however mustnt be saved as a UTXO in the database as they are burnt.

        Therefore, we mark a utxo as an OP_RETURN by setting its address to such
      */
      address: voutAddress ?? "OP_RETURN",
      value_sats: parseInt(utxo.value * 10 ** 8).toString(),
      hash: Transaction.hash,
      vout_index: index,
      block: parseInt(Transaction.block),
      rune_balances: {},
      block_spent: null,
    };
  });
};

const burnFromOpReturnEntry = async (entry, storage) => {
  const { updateAttribute, findOne } = storage;
  const [runeId, amount] = entry;

  const rune = await findOne("Rune", runeId, false, true);

  return updateAttribute(
    "Rune",
    runeId,
    "burnt_amount",
    (BigInt(rune.burnt_amount) + BigInt(amount)).toString()
  );
};

const updateOrCreateBalancesWithUtxo = async (utxo, storage, direction) => {
  const { findManyInFilter, create, updateAttribute } = storage;

  const utxoRuneBalances = Object.entries(JSON.parse(utxo.rune_balances));

  //This filter is an OR filter of ANDs passed to storage, it fetches all corresponding Balances that the utxo is calling
  //for example: [{address, proto_id}, {address, proto_id}...]. While address is the same for all, a utxo can have multiple proto ids
  // [[AND], [AND], [AND]] => [OR]

  const balanceFilter = utxoRuneBalances.map(
    (runeBalance) => `${utxo.address}:${runeBalance[0]}`
  );

  //Get the existing balance entries. We can create hashmap of these with proto_id since address is the same

  //uses optimized lookup by using balance_index
  const existingBalanceEntries = (
    await findManyInFilter("Balance", balanceFilter, true)
  ).reduce((acc, balance) => {
    acc[balance.rune_protocol_id] = balance;
    return acc;
  }, {});

  /*
    The return value of 'existingBalanceEntries' looks looks like this after reduce (mapped by id):
    {
      1: {id: 1, rune_protocol_id: '1:0', address: 'address', balance: '0'}
    }
  */

  for (let entry of utxoRuneBalances) {
    const [rune_protocol_id, amount] = entry;

    let balanceFound = existingBalanceEntries[rune_protocol_id];

    if (!balanceFound) {
      balanceFound = create("Balance", {
        balance_index: `${utxo.address}:${rune_protocol_id}`,
        rune_protocol_id: rune_protocol_id,
        address: utxo.address,
        balance: 0,
      });
    }

    const newBalance = (
      BigInt(balanceFound.balance) +
      BigInt(amount) * BigInt(direction)
    ).toString();

    await updateAttribute(
      "Balance",
      balanceFound.balance_index,
      "balance",
      newBalance
    );
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
  let nonOpReturnOutputs = pendingUtxos.filter(
    (utxo) => utxo.address !== "OP_RETURN"
  );

  if (edicts) {
    const transactionRuneId = `${block}:${txIndex}`;

    //Replace all references of 0:0 with the actual rune id which we have stored on db (Transferring#5)
    edicts.forEach(
      (edict) => (edict.id = edict.id === "0:0" ? transactionRuneId : edict.id)
    );

    let edictFilter = edicts.map((edict) => edict.id);

    //Cache all runes that are currently in DB in a hashmap, if a rune doesnt exist edict will be ignored

    //uses optimized lookup by using rune_protocol_id
    let existingRunes = (
      await findManyInFilter("Rune", edictFilter, true)
    ).reduce((acc, rune) => ({ ...acc, [rune.rune_protocol_id]: rune }), {});

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
  //(edge case) If only an OP_RETURN output is present in the Transaction, transfer to the OP_RETURN

  let pointerOutput =
    nonOpReturnOutputs[pointer ?? 0] ??
    pendingUtxos.find((utxo) => utxo.address === "OP_RETURN");

  //move Unallocated runes to pointer output
  Object.entries(UnallocatedRunes).forEach((allocationData) =>
    allocate(pointerOutput, allocationData[0], allocationData[1])
  );

  //Function returns the burnt runes
  return;
};

const processMint = async (UnallocatedRunes, Transaction, storage) => {
  const { block, txIndex, runestone } = Transaction;
  const mint = runestone?.mint;

  const { findOne, updateAttribute } = storage;

  if (!mint) {
    return UnallocatedRunes;
  }
  //We use the same  process used to calculate the Rune Id in the etch function if "0:0" is referred to
  const runeToMint = await findOne("Rune", mint, false, true);

  if (!runeToMint) {
    //The rune requested to be minted does not exist.
    return UnallocatedRunes;
  }

  if (isMintOpen(block, txIndex, runeToMint, true)) {
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

const processEtching = async (
  UnallocatedRunes,
  Transaction,
  rpc,
  storage,
  isGenesis
) => {
  const { block, txIndex, runestone } = Transaction;

  const etching = runestone?.etching;

  const { findOne, create, local } = storage;

  //If no etching, return the input allocations
  if (!etching) {
    return UnallocatedRunes;
  }

  //This transaction has already etched a rune
  if (local.Rune[`${block}:${txIndex}`]) {
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

  const isRuneNameTaken = !!(await findOne("Rune", runeName, "raw_name", true));

  if (isRuneNameTaken) {
    return UnallocatedRunes;
  }

  //This is processed last since it is the most computationally expensive call (we have to call RPC twice)
  const isReserved = !etching.rune;

  if (!isReserved) {
    const hasValidCommitment = true;
    /* Disabled for now until BTC node is back up

    await checkCommitment(
      runeName,
      Transaction,
      block,
      rpc
    );
    */

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
    rune_protocol_id: !isGenesis ? `${block}:${txIndex}` : "1:0",
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
    burnt_amount: "0",
    //Unmintable is a flag internal to this indexer, and is set specifically for cenotaphs as per the rune spec (see above)
    unmintable: runestone.cenotaph ? 1 : 0,
    etch_transaction: Transaction.hash,
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

const finalizeTransfers = async (
  inputUtxos,
  pendingUtxos,
  Transaction,
  storage
) => {
  const { updateAttribute, create } = storage;
  const { block } = Transaction;

  let opReturnOutput = pendingUtxos.find(
    (utxo) => utxo.address === "OP_RETURN"
  );

  if (opReturnOutput) {
    //Burn all runes from the OP_RETURN output
    await Promise.all(
      Object.entries(opReturnOutput.rune_balances).map((entry) =>
        burnFromOpReturnEntry(entry, storage)
      )
    );
  }

  //Update all input UTXOs as spent
  await Promise.all(
    inputUtxos.map((utxo) =>
      updateAttribute("Utxo", utxo.utxo_index, "block_spent", block)
    )
  );
  //Filter out all OP_RETURN and zero rune balances
  pendingUtxos = pendingUtxos.filter(
    (utxo) =>
      utxo.address !== "OP_RETURN" &&
      Object.values(utxo.rune_balances ?? {}).reduce(
        (a, b) => a + BigInt(b),
        0n
      ) > 0n
  );

  //parse rune_balances for all pendingUtxos
  pendingUtxos.forEach((utxo) => {
    utxo.rune_balances = JSON.stringify(stripObject(utxo.rune_balances));
  });

  //Create all new UTXOs and create a map of their ids (remove all OP_RETURN too as they are burnt)
  pendingUtxos.forEach((utxo) => {
    if (utxo.address !== "OP_RETURN") {
      create("Utxo", utxo).id;
    }
  });

  //Create a vec of all UTXOs and their direction (1 for adding to balance, -1 for subtracting from balance)
  const allUtxos = [
    //Input utxos are spent, so they should be subtracted from balance
    ...inputUtxos.map((utxo) => [utxo, -1]),
    //New utxos are added to balance
    ...pendingUtxos.map((utxo) => [utxo, 1]),
  ];

  //Finally update balance store with new Utxos (we can call these at the same time because they are updated in memory, not on db)
  await Promise.all(
    allUtxos.map(([utxo, direction]) =>
      updateOrCreateBalancesWithUtxo(utxo, storage, direction)
    )
  );

  return;
};

const processRunestone = async (Transaction, rpc, storage) => {
  const { vout, vin, block } = Transaction;

  //Ignore the coinbase transaction (unless genesis rune is being created)
  if (vin[0].coinbase) {
    if (block === GENESIS_BLOCK) {
      await processEtching(
        {},
        { ...Transaction, runestone: GENESIS_RUNESTONE },
        rpc,
        storage,
        true
      );
    }
    return;
  }

  // const SpenderAccount = await _findAccountOrCreate(Transaction, db)

  const { findManyInFilter } = storage;

  let UtxoFilter = vin.map((vin) => `${vin.txid}:${vin.vout}`);

  //Setup Transaction for processing

  //If the utxo is not in db it was made before GENESIS (840,000) anmd therefore does not contain runes

  //We also filter for utxos already sppent (this will never happen on mainnet, but on regtest someone can attempt to spend a utxo already marked as spent in the db)

  //uses optimized lookup by using utxo_index
  let inputUtxos = (await findManyInFilter("Utxo", UtxoFilter, true)).filter(
    (utxo) => !utxo.block_spent
  );

  let pendingUtxos = createNewUtxoBodies(vout, Transaction);

  let UnallocatedRunes = getUnallocatedRunesFromUtxos(inputUtxos);
  //let MappedTransactions = await getParentTransactionsMapFromUtxos(UtxoFilter, db)

  //Delete UTXOs as they are being spent
  // => This should be processed at the end of the block, with filters concatenated.. await Utxo.deleteMany({hash: {$in: UtxoFilter}})

  //Reference of UnallocatedRunes and pendingUtxos is passed around in follwoing functions
  await processEtching(UnallocatedRunes, Transaction, rpc, storage);

  //Mints are processed next and added to the RuneAllocations, with caps being updated (and burnt in case of cenotaphs)

  await processMint(UnallocatedRunes, Transaction, storage);

  //Allocate all transfers from unallocated payload to the pendingUtxos
  await processEdicts(UnallocatedRunes, pendingUtxos, Transaction, storage);

  //Commit the utxos to storage and update Balances
  await finalizeTransfers(inputUtxos, pendingUtxos, Transaction, storage);

  return;
};

const loadBlockIntoMemory = async (block, storage) => {
  const { loadManyIntoMemory, local } = storage;

  //Load all utxos in the block's vin into memory in one call

  //Get a vector of all txHashes in the block
  const transactionHashesInBlock = [
    ...new Set(
      block
        .map((transaction) => transaction.vin.map((utxo) => utxo.txid))
        .flat(Infinity)
        .filter(Boolean)
    ),
  ];

  //Get a vector of all recipients in the block utxo.scriptPubKey?.address
  const recipientsInBlock = [
    ...new Set(
      block
        .map((transaction) =>
          transaction.vout
            .map((utxo) => utxo.scriptPubKey?.address)
            .filter(Boolean)
        )
        .flat(Infinity)
    ),
  ];

  await loadManyIntoMemory("Utxo", {
    hash: {
      [Op.in]: transactionHashesInBlock,
    },
  });

  const utxosInBlock = local.Utxo;
  const balancesInBlock = [
    ...new Set(
      [
        recipientsInBlock,
        Object.values(utxosInBlock).map((utxo) => utxo.address),
      ]
        .flat(Infinity)
        .filter(Boolean)
    ),
  ];

  //Get all rune id in all edicts, mints and utxos (we dont need to get etchings as they are created in memory in the block)
  const runesInBlockById = [
    ...new Set(
      [
        //Get all rune ids in edicts and mints

        block.map((transaction) => [
          transaction.runestone.mint,
          transaction.runestone.edicts?.map((edict) => edict.id),
        ]),

        //Get all rune ids in all utxos balance
        Object.values(utxosInBlock).map((utxo) =>
          Object.keys(JSON.parse(utxo.rune_balances))
        ),
      ]
        .flat(Infinity)
        //0:0 refers to self, not an actual rune
        .filter((rune) => rune && rune?.rune_protocol_id !== "0:0")
    ),
  ];

  const runesInBlockByRawName = [
    ...new Set(block.map((transaction) => transaction.runestone.etching?.rune)),
  ]
    .flat(Infinity)
    //0:0 refers to self, not an actual rune
    .filter((rune) => rune);

  //Load all runes that might be transferred into memory. This would be every Rune in a mint, edict or etch

  await loadManyIntoMemory("Rune", {
    [Op.or]: [
      {
        rune_protocol_id: {
          [Op.in]: runesInBlockById,
        },
      },
      {
        raw_name: {
          [Op.in]: runesInBlockByRawName,
        },
      },
    ],
  });

  //Load the balances of all addresses owning a utxo or in a transactions vout
  await loadManyIntoMemory("Balance", {
    address: {
      [Op.in]: balancesInBlock,
    },
  });

  log(
    "loaded: " + Object.keys(local.Utxo).length + "  utxos into memory",
    "debug"
  );

  log(
    "loaded: " + Object.keys(local.Balance).length + "  balances into memory",
    "debug"
  );
  log(
    "loaded: " + Object.keys(local.Rune).length + "  runes into memory",
    "debug"
  );

  return;
};

const processBlock = async (blockHeight, callRpc, storage, useTest) => {
  const formatMemoryUsage = (data) =>
    `${Math.round((data / 1024 / 1024) * 100) / 100} MB`;

  const memoryData = process.memoryUsage();

  const memoryUsage = {
    rss: `${formatMemoryUsage(memoryData.rss)} ->`,
    heapTotal: `${formatMemoryUsage(memoryData.heapTotal)}`,
    heapUsed: `${formatMemoryUsage(memoryData.heapUsed)}`,
    external: `${formatMemoryUsage(memoryData.external)}`,
  };

  log("MEMSTAT rss: " + memoryUsage.rss, "debug");
  log("MEMSTAT heap(total): " + memoryUsage.heapTotal, "debug");
  log("MEMSTAT heap(used): " + memoryUsage.heapUsed, "debug");
  log("MEMSTAT external: " + memoryUsage.external, "debug");

  const blockData = useTest
    ? testblock
    : await getRunestonesInBlock(blockHeight, callRpc);

  //Load all rows we will manipulate beforehand into memory
  await loadBlockIntoMemory(blockData, storage);
  //await sleep(2000);
  log(
    "Processing " + blockData.length + " transactions for block " + blockHeight
  );
  for (let TransactionIndex in blockData) {
    let Transaction = blockData[TransactionIndex];

    try {
      //REMOVE THIS! This is for the --test flag
      if (useTest) Transaction.block = blockHeight;

      await processRunestone(Transaction, callRpc, storage);
    } catch (e) {
      log(
        "Indexer panic on the following transaction: " +
          "\nhash: " +
          Transaction.hash +
          "\nblock: " +
          blockHeight +
          "\nindex: " +
          TransactionIndex +
          "/" +
          blockData.length,
        "\nrunestome: " + Transaction.runestone + "panic"
      );
      throw e;
    }
  }

  await storage.commitChanges();

  return;
};

module.exports = {
  processBlock,
};
