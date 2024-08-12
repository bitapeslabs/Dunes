require("dotenv").config({ path: "../../.env" });

const { toBigInt, stripObject, log, sleep } = require("./utils");
const {
  isMintOpen,
  getReservedName,
  updateUnallocated,
  minimumLengthAtHeight,
  checkCommitment,
} = require("./runeutils");

const { Op } = require("sequelize");

const { SpacedRune, Rune: OrdRune } = require("@ordjs/runestone");
const { GENESIS_BLOCK, GENESIS_RUNESTONE } = require("./constants");
const { runestone } = require("@runeapes/apeutils");

const NO_COMMITMENTS = process.argv.includes("--no-commitments");

let __debug_totalElapsedTime = {};
let __timer;

let startTimer = () => {
  __timer = Date.now();
};

let stopTimer = (field) => {
  __debug_totalElapsedTime[field] =
    (__debug_totalElapsedTime[field] ?? 0) + Date.now() - __timer;
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
          ? Object.entries(utxo.rune_balances)
          : [];

        //Sum up all Rune balances for each input UTXO
        RuneBalances.forEach((rune) => {
          const [rune_protocol_id, amount] = rune;
          acc[rune_protocol_id] =
            (acc[rune_protocol_id] ?? 0n) + BigInt(amount);
        });

        return acc;
      }, {})
  );
};

const createNewUtxoBodies = (vout, Transaction, storage) => {
  const { findOrCreate, create } = storage;

  return vout.map((utxo) => {
    const voutAddress = findOrCreate(
      "Address",
      utxo.scriptPubKey.address ?? "OP_RETURN",
      { address: utxo.scriptPubKey.address ?? "OP_RETURN" },
      true
    );

    return {
      /*
        SEE: https://docs.ordinals.com/runes.html#Burning
        "Runes may be burned by transferring them to an OP_RETURN output with an edict or pointer."

        This means that an OP_RETURN vout must be saved for processing edicts and unallocated runes,
        however mustnt be saved as a UTXO in the database as they are burnt.

        Therefore, we mark a utxo as an OP_RETURN by setting its address to such
      */
      utxo_index: `${voutAddress.id}:${utxo.n}`,
      address_id: voutAddress.id,
      value_sats: parseInt(utxo.value * 10 ** 8).toString(),
      transaction_id: Transaction.virtual_id,
      vout_index: utxo.n,
      block: parseInt(Transaction.block),
      rune_balances: {},
      block_spent: null,
      transaction_spent_id: null,
    };

    //If the utxo is an OP_RETURN, we dont save it as a UTXO in the database
  });
};

const burnAllFromUtxo = async (utxo, storage) => {
  const { updateAttribute, findOne } = storage;

  Object.entries(utxo.rune_balances).map((entry) => {
    const [runeId, amount] = entry;

    const rune = findOne("Rune", runeId, false, true);

    return updateAttribute(
      "Rune",
      runeId,
      "burnt_amount",
      (BigInt(rune.burnt_amount) + BigInt(amount)).toString()
    );
  });
};

const updateOrCreateBalancesWithUtxo = (utxo, storage, direction) => {
  const { findManyInFilter, create, updateAttribute, findOne } = storage;

  const utxoRuneBalances = Object.entries(utxo.rune_balances);

  //This filter is an OR filter of ANDs passed to storage, it fetches all corresponding Balances that the utxo is calling
  //for example: [{address, proto_id}, {address, proto_id}...]. While address is the same for all, a utxo can have multiple proto ids
  // [[AND], [AND], [AND]] => [OR]

  let runesInUtxo = findManyInFilter(
    "Rune",
    utxoRuneBalances.map((rune) => rune[0]),
    true
  ).reduce((acc, Rune) => {
    //This is safe because rune_protocol_id and id will never overlap as rune_protocol_id is a string that contains a ":"
    acc[Rune.rune_protocol_id] = Rune;
    acc[Rune.id] = Rune;
    return acc;
  }, {});

  const balanceFilter = utxoRuneBalances.map(
    (entry) => `${utxo.address_id}:${runesInUtxo[entry[0]].id}`
  );

  //Get the existing balance entries. We can create hashmap of these with proto_id since address is the same

  //uses optimized lookup by using balance_index
  const existingBalanceEntries = findManyInFilter(
    "Balance",
    balanceFilter,
    true
  ).reduce((acc, balance) => {
    acc[runesInUtxo[balance.rune_id].rune_protocol_id] = balance;
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
        rune_id: findOne("Rune", rune_protocol_id, false, true).id,
        address_id: utxo.address_id,
        balance: 0,
      });
    }

    const newBalance = (
      BigInt(balanceFound.balance) +
      BigInt(amount) * BigInt(direction)
    ).toString();

    updateAttribute(
      "Balance",
      balanceFound.balance_index,
      "balance",
      newBalance
    );
  }

  return;
};

const processEdicts = (
  UnallocatedRunes,
  pendingUtxos,
  Transaction,
  InputData,
  storage
) => {
  const { block, txIndex, runestone, vin } = Transaction;
  const { findManyInFilter, create, findOne, findOrCreate } = storage;

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
      unallocated < amount || amount === 0n ? unallocated : amount;

    UnallocatedRunes[runeId] = (unallocated ?? 0n) - withDefault;

    utxo.rune_balances[runeId] =
      (utxo.rune_balances[runeId] ?? 0n) + withDefault;

    //Dont save transfer events of amount "0"
    if (withDefault === 0n) return;

    let rune = findOne("Rune", runeId, false, true);

    //If coinbase they were not transferred from an address
    let fromAddress = InputData.runes[runeId]
      ? InputData.sender ?? "UNALLOCATED"
      : "UNALLOCATED";

    let toAddress = utxo.address_id;

    create("Event", {
      type: 2,
      block,
      transaction_id: Transaction.virtual_id,
      rune_id: rune.id,
      amount: withDefault.toString(),
      from_address_id: findOrCreate(
        "Address",
        fromAddress,
        {
          address: fromAddress,
        },
        true
      ).id,
      to_address_id: toAddress,
    });
  };

  //References are kept because filter does not clone the array
  let nonOpReturnOutputs = pendingUtxos.filter((utxo) => utxo.address_id !== 2);

  if (edicts) {
    const transactionRuneId = `${block}:${txIndex}`;

    //Replace all references of 0:0 with the actual rune id which we have stored on db (Transferring#5)
    edicts.forEach(
      (edict) => (edict.id = edict.id === "0:0" ? transactionRuneId : edict.id)
    );

    //Get rune ids from edicts for filter below (the rune id is the PrimaryKey)
    let edictFilter = edicts.map((edict) => edict.id);

    //Cache all runes that are currently in DB in a hashmap, if a rune doesnt exist edict will be ignored

    //uses optimized lookup by using rune_protocol_id
    let existingRunes = findManyInFilter("Rune", edictFilter, true).reduce(
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
        //Edict amount is in string, not bigint
        if (edict.amount === "0") {
          /*
              An edict with amount zero and output equal to the number of transaction outputs divides all unallocated units of rune id between each non OP_RETURN output.
          */

          const amountOutputs = BigInt(nonOpReturnOutputs.length);
          //By default all txs have exactly one OP_RETURN, because they are needed for runestones. More than 1 OP_RETURN is considered non-standard and ignored by btc nodes.

          /*
            https://github.com/ordinals/ord/pull/3547/commits/30c0b39d398f5f2934c87762f53e0e0591b0aadf?diff=unified&w=0
            AND
            https://twitter.com/raphjaph/status/1782581416716357998/photo/2
          */
          if (amountOutputs > 0) {
            const amount = BigInt(UnallocatedRunes[edict.id]) / amountOutputs;
            const remainder =
              BigInt(UnallocatedRunes[edict.id]) % amountOutputs;

            const withRemainder = amount + BigInt(1);

            nonOpReturnOutputs.forEach((utxo, index) =>
              allocate(
                utxo,
                edict.id,
                index < remainder ? withRemainder : amount
              )
            );
          }
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

  let pointerOutput = pendingUtxos[pointer] ?? nonOpReturnOutputs[0];

  //pointerOutput should never be undefined since there is always either a non-opreturn or an op-return output in a transaction

  if (!pointerOutput) {
    //pointer is not provided and there are no non-OP_RETURN outputs
    pointerOutput = pendingUtxos.find((utxo) => utxo.address_id === 2);
  }

  //move Unallocated runes to pointer output
  Object.entries(UnallocatedRunes).forEach((allocationData) =>
    allocate(pointerOutput, allocationData[0], allocationData[1])
  );

  //Function returns the burnt runes
  return;
};

const processMint = (UnallocatedRunes, Transaction, storage) => {
  const { block, txIndex, runestone } = Transaction;
  const mint = runestone?.mint;

  const { findOne, updateAttribute, create, findOrCreate } = storage;

  if (!mint) {
    return UnallocatedRunes;
  }
  //We use the same  process used to calculate the Rune Id in the etch function if "0:0" is referred to
  const runeToMint = findOne("Rune", mint, false, true);

  if (!runeToMint) {
    //The rune requested to be minted does not exist.
    return UnallocatedRunes;
  }

  if (isMintOpen(block, txIndex, runeToMint, true)) {
    //Update new mints to count towards cap

    let newMints = (BigInt(runeToMint.mints) + BigInt(1)).toString();
    updateAttribute("Rune", runeToMint.rune_protocol_id, "mints", newMints);

    if (runestone.cenotaph) {
      //If the mint is a cenotaph, the minted amount is burnt
      return UnallocatedRunes;
    }

    //Emit MINT event on block
    create("Event", {
      type: 1,
      block,
      transaction_hash: Transaction.virtual_id,
      rune_id: runeToMint.id,
      amount: runeToMint.mint_amount,
      from_address_id: findOrCreate(
        "Address",
        "GENESIS",
        {
          address: "GENESIS",
        },
        true
      ).id,
      to_address_id: findOrCreate(
        "Address",
        "UNALLOCATED",
        {
          address: "UNALLOCATED",
        },
        true
      ).id,
    });

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
  isGenesis,
  useTest
) => {
  const { block, txIndex, runestone } = Transaction;

  const etching = runestone?.etching;

  const { findOne, create, local, findOrCreate } = storage;

  //If no etching, return the input allocations
  if (!etching) {
    return UnallocatedRunes;
  }

  //This transaction has already etched a rune
  if (findOne("Rune", `${block}:${txIndex}`, false, true)) {
    if (Transaction.hash === "spyhash") {
      console.log("STOPA");
    }
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

  const isRuneNameTaken = !!findOne(
    "Rune",
    runeName + "@REF@raw_name",
    false,
    true
  );

  if (isRuneNameTaken) {
    return UnallocatedRunes;
  }

  //This is processed last since it is the most computationally expensive call (we have to call RPC twice)
  const isReserved = !etching.rune;

  if (!isReserved && !useTest && !isGenesis && !NO_COMMITMENTS) {
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

  //FAILS AT 842255:596 111d77cbcb1ee54e0392de588cb7ef794c4a0a382155814e322d93535abc9c66)
  //This is a weird bug in the WASM implementation of the decoder where a "char" that might be valid in rust is shown as 0 bytes in JS.
  //Even weirder - sequelize rejects this upsert saying its "too long"
  const isSafeChar = Number(
    "0x" + Buffer.from(etching.symbol ?? "").toString("hex")
  );

  const symbol = etching.symbol && isSafeChar ? etching.symbol : "¤";

  const EtchedRune = create("Rune", {
    rune_protocol_id: !isGenesis ? `${block}:${txIndex}` : "1:0",
    name: spacedRune ? spacedRune.name : runeName,
    raw_name: runeName,
    symbol,
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
    mint_start: etching.terms?.height?.[0]?.toString() ?? null,
    mint_end: etching.terms?.height?.[1]?.toString() ?? null,
    mint_offset_start: etching.terms?.offset?.[0]?.toString() ?? null,
    mint_offset_end: etching.terms?.offset?.[1]?.toString() ?? null,
    turbo: etching.turbo,
    burnt_amount: "0",
    //Unmintable is a flag internal to this indexer, and is set specifically for cenotaphs as per the rune spec (see above)
    unmintable: runestone.cenotaph || !etching.terms?.amount ? 1 : 0,
    etch_transaction_id: Transaction.virtual_id,
  });

  //Emit Etch event on block
  create("Event", {
    type: 0,
    block,
    transaction_id: Transaction.virtual_id,
    rune_id: EtchedRune.id,
    amount: etching.premine ?? "0",
    from_address_id: findOrCreate(
      "Address",
      "GENESIS",
      { address: "GENESIS" },
      true
    ).id,
    to_address_id: findOrCreate(
      "Address",
      "UNALLOCATED",
      { address: "UNALLOCATED" },
      true
    ).id,
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
  const { updateAttribute, create, local, findOne } = storage;
  const { block, runestone } = Transaction;

  let opReturnOutput = pendingUtxos.find((utxo) => utxo.address_id === 2);

  //Burn all runes from cenotaphs or OP_RETURN outputs (if no cenotaph is present)
  if (runestone.cenotaph) {
    inputUtxos.forEach((utxo) => burnAllFromUtxo(utxo, storage));
  } else if (opReturnOutput) {
    burnAllFromUtxo(opReturnOutput, storage);
  }

  //Update all input UTXOs as spent
  inputUtxos.forEach((utxo) => {
    updateAttribute("Utxo", utxo.utxo_index, "block_spent", block, false);
    updateAttribute(
      "Utxo",
      utxo.utxo_index,
      "transaction_spent_id",
      Transaction.virtual_id,
      false
    );
  });
  //Filter out all OP_RETURN and zero rune balances. This also removes UTXOS that were in a cenotaph because they will have a balance of 0
  pendingUtxos = pendingUtxos.filter(
    (utxo) =>
      utxo.address_id !== 2 &&
      Object.values(utxo.rune_balances ?? {}).reduce(
        (a, b) => a + BigInt(b),
        0n
      ) > 0n
  );

  //Create all new UTXOs and create a map of their ids (remove all OP_RETURN too as they are burnt). Ignore on cenotaphs
  pendingUtxos.forEach((utxo) => {
    if (utxo.address_id !== 2) {
      let resultUtxo = { ...utxo };
      delete resultUtxo.rune_balances;

      const parentUtxo = create("Utxo", resultUtxo);

      Object.keys(utxo.rune_balances).forEach((runeProtocolId) => {
        if (!utxo.rune_balances[runeProtocolId]) return; //Ignore 0 balances
        create(
          "Utxo_balance",
          {
            utxo_id: parentUtxo.id,
            rune_id: findOne("Rune", runeProtocolId, false, true).id,
            balance: utxo.rune_balances[runeProtocolId],
          },
          false,
          true
        );
      });
    }
  });

  //Create a vec of all UTXOs and their direction (1 for adding to balance, -1 for subtracting from balance)
  const allUtxos = [
    //Input utxos are spent, so they should be subtracted from balance
    ...inputUtxos.map((utxo) => [utxo, -1]),
    //New utxos are added to balance (empty array if cenotaph because of the filter above)
    ...pendingUtxos.map((utxo) => [utxo, 1]),
  ];

  //Finally update balance store with new Utxos (we can call these at the same time because they are updated in memory, not on db)

  allUtxos.map(([utxo, direction]) =>
    updateOrCreateBalancesWithUtxo(utxo, storage, direction)
  );

  return;
};

const handleGenesis = async (Transaction, rpc, storage) => {
  const { findOrCreate } = storage;

  startTimer();
  findOrCreate("Address", "GENESIS", { address: "GENESIS" }, true);
  findOrCreate("Address", "OP_RETURN", { address: "OP_RETURN" }, true);
  findOrCreate("Address", "UNALLOCATED", { address: "UNALLOCATED" }, true);
  stopTimer("body_init_header");

  await processEtching(
    {},
    { ...Transaction, runestone: GENESIS_RUNESTONE },
    rpc,
    storage,
    true
  );

  return;
};

const processRunestone = async (Transaction, rpc, storage, useTest) => {
  const { vout, vin, block, hash } = Transaction;

  const { create, fetchGroupLocally, findOne, local } = storage;

  //Ignore the coinbase transaction (unless genesis rune is being created)

  //Setup Transaction for processing

  //If the utxo is not in db it was made before GENESIS (840,000) anmd therefore does not contain runes

  //We also filter for utxos already sppent (this will never happen on mainnet, but on regtest someone can attempt to spend a utxo already marked as spent in the db)

  //Ignore coinbase tx if not genesis since it has no input utxos

  startTimer();

  let UtxoFilter = vin.map(
    (vin) =>
      `${findOne("Transaction", vin.txid, false, true)?.id ?? "-1"}:${vin.vout}`
  );

  stopTimer("body_init_filter_generator");

  let inputUtxos = UtxoFilter.map((utxoIndex) => {
    const utxo = findOne("Utxo", utxoIndex, false, true);

    if (!utxo) return null;

    const balances = fetchGroupLocally("Utxo_balance", "utxo_id", utxo.id);

    return {
      ...utxo,
      rune_balances: balances.reduce((acc, utxoBalance) => {
        acc[
          findOne(
            "Rune",
            utxoBalance.rune_id + "@REF@id",
            false,
            true
          ).rune_protocol_id
        ] = utxoBalance.balance;
        return acc;
      }, {}),
    };
  }).filter(Boolean);

  stopTimer("body_init_utxo_fetch");

  if (
    //If no input utxos are provided (with runes inside)
    inputUtxos.length === 0 &&
    //AND there is no runestone field in the transaction (aside from cenotaph)
    Object.keys(Transaction.runestone).length === 1
  ) {
    //We can return as this transaction will not mint or create new utxos. This saves storage for unrelated transactions
    if (!(vin[0].coinbase && block == GENESIS_BLOCK)) return;
  }

  const parentTransaction = create("Transaction", { hash }, false, true);

  Transaction.virtual_id = parentTransaction.id;

  if (vin[0].coinbase && block === GENESIS_BLOCK)
    await handleGenesis(Transaction, rpc, storage);

  startTimer();

  let pendingUtxos = createNewUtxoBodies(vout, Transaction, storage);

  let UnallocatedRunes = getUnallocatedRunesFromUtxos(inputUtxos);

  /*
  Create clone of Unallocated Runes, this will be used when emitting the "Transfer" event. If the Rune was present in the original
  runes from vin we have the address indexed on db and can emit the transfer event with the "From" equalling the address of transaction signer.
  However, if the Rune was not present in the original runes from vin, we can only emit the "From" as "UNALLOCATED" since we dont have the address indexed
  and the runes in the final Unallocated Runes Buffer came from the etching or minting process and were created in the transaction.
  */
  let InputData = {
    sender: inputUtxos.length ? inputUtxos[0].address : null,
    runes: { ...UnallocatedRunes },
  };
  //let MappedTransactions = await getParentTransactionsMapFromUtxos(UtxoFilter, db)

  //Delete UTXOs as they are being spent
  // => This should be processed at the end of the block, with filters concatenated.. await Utxo.deleteMany({hash: {$in: UtxoFilter}})

  //Reference of UnallocatedRunes and pendingUtxos is passed around in follwoing functions
  //Process etching is potentially asyncrhnous because of commitment checks
  stopTimer("body_init_pending_utxo_creation");

  startTimer();
  await processEtching(
    UnallocatedRunes,
    Transaction,
    rpc,
    storage,
    false,
    useTest
  );
  stopTimer("etch");

  //Mints are processed next and added to the RuneAllocations, with caps being updated (and burnt in case of cenotaphs)

  startTimer();
  processMint(UnallocatedRunes, Transaction, storage);
  stopTimer("mint");

  //Allocate all transfers from unallocated payload to the pendingUtxos
  startTimer();
  processEdicts(
    UnallocatedRunes,
    pendingUtxos,
    Transaction,
    InputData,
    storage
  );
  stopTimer("edicts");

  //Commit the utxos to storage and update Balances

  startTimer();
  finalizeTransfers(inputUtxos, pendingUtxos, Transaction, storage);
  stopTimer("transfers");
  return;
};

const loadBlockIntoMemory = async (block, storage) => {
  /*
  Necessary indexes for building (the rest can be built afterwards)

  Transaction -> hash
  Utxo -> ( transaction_id, vout_index )
  Address -> address
  Rune -> rune_protocol_id, raw_name
    Balance -> address_id
  */

  //Events do not need to be loaded as they are purely write and unique

  if (!Array.isArray(block)) {
    console.log(block);
    throw "Non array block passed to loadBlockIntoMemory";
  }

  const { loadManyIntoMemory, local, findOne } = storage;

  //Load all utxos in the block's vin into memory in one call

  const transactionHashInputsInBlock = [
    ...new Set(
      block
        .map((transaction) => transaction.vin.map((utxo) => utxo.txid))
        .flat(Infinity)
        .filter(Boolean)
    ),
  ];

  await loadManyIntoMemory("Transaction", {
    hash: {
      [Op.in]: transactionHashInputsInBlock,
    },
  });

  //Get a vector of all txHashes in the block
  const utxosInBlock = [
    ...new Set(
      block
        .map((transaction) =>
          transaction.vin.map((utxo) => {
            let foundTransaction = findOne(
              "Transaction",
              utxo.txid,
              false,
              true
            );

            //coinbase txs dont have a vin
            if (utxo.vout === undefined) {
              return null;
            }

            return foundTransaction
              ? {
                  transaction_id: foundTransaction.id,
                  vout_index: utxo.vout,
                }
              : null;
          })
        )
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

  const query = {
    [Op.or]: utxosInBlock.map((utxo) => {
      const { transaction_id, vout_index } = utxo;

      return {
        transaction_id,
        vout_index,
      };
    }),
  };

  await loadManyIntoMemory("Utxo", query);

  const utxosInLocal = local.Utxo;

  const utxoBalancesInBlock = [
    ...new Set(Object.values(utxosInLocal).map((utxo) => utxo.id)),
  ];

  await loadManyIntoMemory("Utxo_balance", {
    utxo_id: {
      [Op.in]: utxoBalancesInBlock,
    },
  });

  const utxoBalancesInLocal = local.Utxo_balance;

  const addressesInBlock = [
    ...new Set(
      [
        recipientsInBlock,
        Object.values(utxosInLocal).map((utxo) => utxo.address),
      ]
        .flat(Infinity)
        .filter(Boolean)
    ),
  ];

  await loadManyIntoMemory("Address", {
    address: {
      [Op.in]: ["GENESIS", "UNALLOCATED", "OP_RETURN", ...addressesInBlock],
    },
  });

  const balancesInBlock = addressesInBlock
    .map((address) => findOne("Address", address, false, true)?.id)
    .filter(Boolean);

  //Get all rune id in all edicts, mints and utxos (we dont need to get etchings as they are created in memory in the block)
  const runesInBlockByProtocolId = [
    ...new Set(
      [
        //Get all rune ids in edicts and mints

        block.map((transaction) => [
          transaction.runestone.mint,
          transaction.runestone.edicts?.map((edict) => edict.id),
        ]),
      ]
        .flat(Infinity)
        //0:0 refers to self, not an actual rune
        .filter((rune) => rune && rune?.rune_protocol_id !== "0:0")
    ),
  ];

  const runesInBlockByDbId = [
    ...new Set(
      //Get all rune ids in all utxos balance
      Object.values(utxoBalancesInLocal).map((utxo) => utxo.rune_id)
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
          [Op.in]: runesInBlockByProtocolId,
        },
      },
      {
        raw_name: {
          [Op.in]: runesInBlockByRawName,
        },
      },
      {
        id: {
          [Op.in]: runesInBlockByDbId,
        },
      },
    ],
  });

  //Load the balances of all addresses owning a utxo or in a transactions vout
  await loadManyIntoMemory("Balance", {
    address_id: {
      [Op.in]: balancesInBlock,
    },
  });
  log(
    "loaded: " + Object.keys(local.Address).length + "  adresses into memory",
    "debug"
  );

  log(
    "loaded: " + Object.keys(local.Transaction).length + "  txs into memory",
    "debug"
  );

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

const processBlock = async (block, callRpc, storage, useTest) => {
  const { blockHeight, blockData } = block;

  const formatMemoryUsage = (data) =>
    `${Math.round((data / 1024 / 1024) * 100) / 100} MB`;

  const memoryData = process.memoryUsage();

  for (const [key, value] of Object.entries(memoryData)) {
    log(`${key}: ${formatMemoryUsage(value)}`, "debug");
  }
  //await sleep(2000);
  log(
    "Processing " + blockData.length + " transactions for block " + blockHeight
  );
  for (let TransactionIndex in blockData) {
    let Transaction = blockData[TransactionIndex];

    try {
      //REMOVE THIS! This is for the --test flag
      if (useTest) Transaction.block = blockHeight;

      await processRunestone(Transaction, callRpc, storage, useTest);
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
          blockData.length +
          "\nrunestone: " +
          JSON.stringify(Transaction.runestone),
        "panic"
      );
      throw e;
    }
  }

  Object.keys(__debug_totalElapsedTime).forEach((field) => {
    log(
      `Time spent on ${field}: ${__debug_totalElapsedTime[field]}ms`,
      "debug"
    );
  });

  __debug_totalElapsedTime = {};

  return;
};

module.exports = {
  processBlock,
  loadBlockIntoMemory,
};
