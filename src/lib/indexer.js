require("dotenv").config({ path: "../../.env" });

const { toBigInt, stripObject, log, sleep } = require("./utils");
const {
  isMintOpen,
  isPriceTermsMet,
  updateUnallocated,
  minimumLengthAtHeight,
  isUsefulDuneTx,
} = require("./duneutils");

const { Op } = require("sequelize");

const { GENESIS_BLOCK, GENESIS_DUNESTONE } = require("./constants");

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

const getUnallocatedDunesFromUtxos = (inputUtxos) => {
  /*
        Important: Dune Balances from this function are returned in big ints in the following format
        {
            [dune_protocol_id]: BigInt(amount)
        }

        dune_protocol_id => is the dune_id used by the Dunes Protocol and is recognized, 
        different from dune_id which is used by the DB for indexing.
    */

  return (
    inputUtxos

      //Get allocated dunes and store them in an array
      .reduce((acc, utxo) => {
        let DuneBalances = utxo.dune_balances
          ? Object.entries(utxo.dune_balances)
          : [];

        //Sum up all Dune balances for each input UTXO
        DuneBalances.forEach((dune) => {
          const [dune_protocol_id, amount] = dune;
          acc[dune_protocol_id] =
            (acc[dune_protocol_id] ?? 0n) + BigInt(amount);
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
        SEE: https://docs.ordinals.com/dunes.html#Burning
        "Dunes may be burned by transferring them to an OP_RETURN output with an edict or pointer."

        This means that an OP_RETURN vout must be saved for processing edicts and unallocated dunes,
        however mustnt be saved as a UTXO in the database as they are burnt.

        Therefore, we mark a utxo as an OP_RETURN by setting its address to such
      */
      utxo_index: `${voutAddress.id}:${utxo.n}`,
      address_id: voutAddress.id,
      value_sats: BigInt(Math.round(utxo.value * 1e8)).toString(),
      transaction_id: Transaction.virtual_id,
      vout_index: utxo.n,
      block: parseInt(Transaction.block),
      dune_balances: {},
      block_spent: null,
      transaction_spent_id: null,
    };

    //If the utxo is an OP_RETURN, we dont save it as a UTXO in the database
  });
};

const burnAllFromUtxo = (utxo, storage) => {
  const { updateAttribute, findOne } = storage;

  Object.entries(utxo.dune_balances).map((entry) => {
    const [duneId, amount] = entry;

    const dune = findOne("Dune", duneId, false, true);

    return updateAttribute(
      "Dune",
      duneId,
      "burnt_amount",
      (BigInt(dune.burnt_amount) + BigInt(amount)).toString()
    );
  });
};

const updateOrCreateBalancesWithUtxo = (utxo, storage, direction) => {
  const { findManyInFilter, create, updateAttribute, findOne } = storage;

  const utxoDuneBalances = Object.entries(utxo.dune_balances);

  //This filter is an OR filter of ANDs passed to storage, it fetches all corresponding Balances that the utxo is calling
  //for example: [{address, proto_id}, {address, proto_id}...]. While address is the same for all, a utxo can have multiple proto ids
  // [[AND], [AND], [AND]] => [OR]

  let dunesInUtxo = findManyInFilter(
    "Dune",
    utxoDuneBalances.map((dune) => dune[0]),
    true
  ).reduce((acc, Dune) => {
    //This is safe because dune_protocol_id and id will never overlap as dune_protocol_id is a string that contains a ":"
    acc[Dune.dune_protocol_id] = Dune;
    acc[Dune.id] = Dune;
    return acc;
  }, {});

  const balanceFilter = utxoDuneBalances.map(
    (entry) => `${utxo.address_id}:${dunesInUtxo[entry[0]].id}`
  );

  //Get the existing balance entries. We can create hashmap of these with proto_id since address is the same

  //uses optimized lookup by using balance_index
  const existingBalanceEntries = findManyInFilter(
    "Balance",
    balanceFilter,
    true
  ).reduce((acc, balance) => {
    acc[dunesInUtxo[balance.dune_id].dune_protocol_id] = balance;
    return acc;
  }, {});

  /*
    The return value of 'existingBalanceEntries' looks looks like this after reduce (mapped by id):
    {
      1: {id: 1, dune_protocol_id: '1:0', address: 'address', balance: '0'}
    }
  */

  for (let entry of utxoDuneBalances) {
    const [dune_protocol_id, amount] = entry;

    let balanceFound = existingBalanceEntries[dune_protocol_id];

    if (!balanceFound) {
      balanceFound = create("Balance", {
        dune_id: findOne("Dune", dune_protocol_id, false, true).id,
        address_id: utxo.address_id,
        balance: 0,
      });
    }

    const newBalance =
      BigInt(balanceFound.balance) + BigInt(amount) * BigInt(direction);

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
  UnallocatedDunes,
  pendingUtxos,
  Transaction,
  transfers,
  storage
) => {
  const { block, txIndex, dunestone, vin } = Transaction;
  const { findManyInFilter, create, findOne, findOrCreate } = storage;

  let { edicts, pointer } = dunestone;

  if (dunestone.cenotaph) {
    //Transaction is a cenotaph, input dunes are burnt.
    //https://docs.ordinals.com/dunes/specification.html#Transferring

    transfers.burn = Object.keys(UnallocatedDunes).reduce((acc, duneId) => {
      acc[duneId] = UnallocatedDunes[duneId];
      return acc;
    }, {});
    return {};
  }

  let allocate = (utxo, duneId, amount) => {
    /*
        See: https://docs.ordinals.com/dunes/specification.html#Trasnferring
        
        An edict with amount zero allocates all remaining units of dune id.
      
        If an edict would allocate more dunes than are currently unallocated, the amount is reduced to the number of currently unallocated dunes. In other words, the edict allocates all remaining unallocated units of dune id.


    */
    let unallocated = UnallocatedDunes[duneId];
    let withDefault =
      unallocated < amount || amount === 0n ? unallocated : amount;

    UnallocatedDunes[duneId] = (unallocated ?? 0n) - withDefault;

    utxo.dune_balances[duneId] =
      (utxo.dune_balances[duneId] ?? 0n) + withDefault;

    //Dont save transfer events of amount "0"
    if (withDefault === 0n) return;

    let toAddress = utxo.address_id === 2 ? "burn" : utxo.address_id;

    if (!transfers[toAddress]) {
      transfers[toAddress] = {};
    }
    if (!transfers[toAddress][duneId]) {
      transfers[toAddress][duneId] = 0n;
    }

    transfers[toAddress][duneId] += withDefault;
  };

  //References are kept because filter does not clone the array
  let nonOpReturnOutputs = pendingUtxos.filter((utxo) => utxo.address_id !== 2);

  if (edicts) {
    const transactionDuneId = `${block}:${txIndex}`;

    //Replace all references of 0:0 with the actual dune id which we have stored on db (Transferring#5)
    edicts.forEach(
      (edict) => (edict.id = edict.id === "0:0" ? transactionDuneId : edict.id)
    );

    //Get dune ids from edicts for filter below (the dune id is the PrimaryKey)
    let edictFilter = edicts.map((edict) => edict.id);

    //Cache all dunes that are currently in DB in a hashmap, if a dune doesnt exist edict will be ignored

    //uses optimized lookup by using dune_protocol_id
    let existingDunes = findManyInFilter("Dune", edictFilter, true).reduce(
      (acc, dune) => ({ ...acc, [dune.dune_protocol_id]: dune }),
      {}
    );

    for (let edictIndex in edicts) {
      let edict = edicts[edictIndex];
      //A dunestone may contain any number of edicts, which are processed in sequence.
      if (!existingDunes[edict.id]) {
        //If the dune does not exist, the edict is ignored
        continue;
      }

      if (!UnallocatedDunes[edict.id]) {
        //If the dune is not in the unallocated dunes, it is ignored
        continue;
      }

      if (edict.output === pendingUtxos.length) {
        //Edict amount is in string, not bigint
        if (edict.amount === "0") {
          /*
              An edict with amount zero and output equal to the number of transaction outputs divides all unallocated units of dune id between each non OP_RETURN output.
          */

          const amountOutputs = BigInt(nonOpReturnOutputs.length);
          //By default all txs have exactly one OP_RETURN, because they are needed for dunestones. More than 1 OP_RETURN is considered non-standard and ignored by btc nodes.

          /*
            https://github.com/ordinals/ord/pull/3547/commits/30c0b39d398f5f2934c87762f53e0e0591b0aadf?diff=unified&w=0
            AND
            https://twitter.com/raphjaph/status/1782581416716357998/photo/2
          */
          if (amountOutputs > 0) {
            const amount = BigInt(UnallocatedDunes[edict.id]) / amountOutputs;
            const remainder =
              BigInt(UnallocatedDunes[edict.id]) % amountOutputs;

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
          //If an edict would allocate more dunes than are currently unallocated, the amount is reduced to the number of currently unallocated dunes. In other words, the edict allocates all remaining unallocated units of dune id.

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

  //Transfer remaining dunes to the first non-opreturn output
  //(edge case) If only an OP_RETURN output is present in the Transaction, transfer to the OP_RETURN

  let pointerOutput = pendingUtxos[pointer] ?? nonOpReturnOutputs[0];

  //pointerOutput should never be undefined since there is always either a non-opreturn or an op-return output in a transaction

  if (!pointerOutput) {
    //pointer is not provided and there are no non-OP_RETURN outputs
    pointerOutput = pendingUtxos.find((utxo) => utxo.address_id === 2);
  }

  //move Unallocated dunes to pointer output
  Object.entries(UnallocatedDunes).forEach((allocationData) =>
    allocate(pointerOutput, allocationData[0], allocationData[1])
  );

  //Function returns the burnt dunes
  return;
};

const processMint = (UnallocatedDunes, Transaction, storage) => {
  const { block, txIndex, dunestone } = Transaction;
  const mint = dunestone?.mint;

  const { findOne, updateAttribute, create, findOrCreate } = storage;

  if (!mint) {
    return UnallocatedDunes;
  }
  //We use the same  process used to calculate the Dune Id in the etch function if "0:0" is referred to
  const duneToMint = findOne("Dune", mint, false, true);

  if (!duneToMint) {
    //The dune requested to be minted does not exist.
    return UnallocatedDunes;
  }

  if (!isPriceTermsMet(duneToMint, Transaction)) {
    return UnallocatedDunes;
  }

  if (isMintOpen(block, txIndex, duneToMint, true)) {
    //Update new mints to count towards cap

    let newMints = (BigInt(duneToMint.mints) + BigInt(1)).toString();
    updateAttribute("Dune", duneToMint.dune_protocol_id, "mints", newMints);

    if (dunestone.cenotaph) {
      //If the mint is a cenotaph, the minted amount is burnt
      return UnallocatedDunes;
    }

    //Emit MINT event on block
    create("Event", {
      type: 1,
      block,
      transaction_id: Transaction.virtual_id,
      dune_id: duneToMint.id,
      amount: duneToMint.mint_amount,
      from_address_id: findOrCreate(
        "Address",
        Transaction.sender ?? "UNKNOWN",
        { address: Transaction.sender },
        true
      ).id,
      to_address_id: 2,
    });

    let isFlex = dunestone?.mint?.terms?.amount == 0;
    let mintAmount = BigInt(dunestone.mint.amount);

    if (isFlex) {
      const payTo = dunestone.mint.terms?.price?.pay_to;
      const priceAmount = dunestone.mint.terms?.price?.amount;

      if (!payTo) throw new Error("Missing pay_to address in price terms");
      if (!priceAmount || BigInt(priceAmount) === 0n)
        throw new Error("Invalid price amount");

      const totalRecv = Transaction.vout
        .filter((v) => v.scriptPubKey?.address === payTo)
        .map((v) => BigInt(v.value))
        .reduce((a, b) => a + b, 0n);

      mintAmount = totalRecv / BigInt(priceAmount);
    }

    return updateUnallocated(UnallocatedDunes, {
      dune_id: duneToMint.dune_protocol_id,
      amount: BigInt(duneToMint.mint_amount),
    });
  } else {
    //Minting is closed
    return UnallocatedDunes;
  }
};

const processEtching = (
  UnallocatedDunes,
  Transaction,
  rpc,
  storage,
  isGenesis,
  useTest
) => {
  const { block, txIndex, dunestone } = Transaction;

  const etching = dunestone?.etching;

  const { findOne, create, local, findOrCreate } = storage;

  //If no etching, return the input allocations
  if (!etching) {
    return UnallocatedDunes;
  }

  //This transaction has already etched a dune
  if (findOne("Dune", `${block}:${txIndex}`, false, true)) {
    return UnallocatedDunes;
  }

  //If dune name already taken, it is non standard, return the input allocations

  //Cenotaphs dont have any other etching properties other than their name
  //If not a cenotaph, check if a dune name was provided, and if not, generate one

  let duneName = etching.dune;

  const isDuneNameTaken = !!findOne(
    "Dune",
    duneName + "@REF@name",
    false,
    true
  );

  if (isDuneNameTaken) {
    return UnallocatedDunes;
  }

  let isFlex = !!etching?.terms?.amount;

  if (isFlex && !etching?.terms?.price) {
    //An etch attempting to use "flex mode" for mint that doesnt provide amount is invalid
    return UnallocatedDunes;
  }

  /*
    Dunespec: Dunes etched in a transaction with a cenotaph are set as unmintable.

    If the dunestone decoded has the cenotaph flag set to true, the dune should be created with no allocationg created

    see unminable flag in dune model
  */

  //FAILS AT 842255:596 111d77cbcb1ee54e0392de588cb7ef794c4a0a382155814e322d93535abc9c66)
  //This is a weird bug in the WASM implementation of the decoder where a "char" that might be valid in rust is shown as 0 bytes in JS.
  //Even weirder - sequelize rejects this upsert saying its "too long"
  const isSafeChar = Number(
    "0x" + Buffer.from(etching.symbol ?? "").toString("hex")
  );

  const symbol = etching.symbol && isSafeChar ? etching.symbol : "¤";

  const etcherId = findOrCreate(
    "Address",
    Transaction.sender ?? "UNKNOWN",
    { address: Transaction.sender },
    true
  ).id;

  const EtchedDune = create("Dune", {
    dune_protocol_id: !isGenesis ? `${block}:${txIndex}` : "1:0",
    name: duneName,
    symbol,

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
    price_amount: etching.terms?.price?.amount ?? null,
    price_pay_to: etching.terms?.price?.pay_to ?? null,
    turbo: etching.turbo,
    burnt_amount: "0",
    //Unmintable is a flag internal to this indexer, and is set specifically for cenotaphs as per the dune spec (see above)
    unmintable: dunestone.cenotaph || !etching.terms?.amount ? 1 : 0,
    etch_transaction_id: Transaction.virtual_id,
    deployer_address_id: etcherId,
  });

  //Emit Etch event on block
  create("Event", {
    type: 0,
    block,
    transaction_id: Transaction.virtual_id,
    dune_id: EtchedDune.id,
    amount: etching.premine ?? "0",
    from_address_id: etcherId,
    to_address_id: 2,
  });

  //Add premine dunes to input allocations

  if (dunestone.cenotaph) {
    //No dunes are premined if the tx is a cenotaph.
    return UnallocatedDunes;
  }

  return updateUnallocated(UnallocatedDunes, {
    dune_id: EtchedDune.dune_protocol_id,
    amount: BigInt(EtchedDune.premine),
  });
};

const emitTransferAndBurnEvents = (transfers, Transaction, storage) => {
  const { create, findOrCreate, findOne } = storage;

  Object.keys(transfers).forEach((addressId) => {
    Object.keys(transfers[addressId]).forEach((dune_protocol_id) => {
      let amount = transfers[addressId][dune_protocol_id];
      if (!amount) return; //Ignore 0 balances

      create("Event", {
        type: addressId === "burn" ? 3 : 2,
        block: Transaction.block,
        transaction_id: Transaction.virtual_id,
        dune_id: findOne("Dune", dune_protocol_id, false, true).id,
        amount,
        from_address_id: findOrCreate(
          "Address",
          Transaction.sender ?? "UNKNOWN",
          { address: Transaction.sender },
          true
        ).id,
        to_address_id: addressId === "burn" ? 2 : addressId,
      });
    });
  });

  return;
};

const finalizeTransfers = (
  inputUtxos,
  pendingUtxos,
  Transaction,
  transfers,
  storage
) => {
  const { updateAttribute, create, local, findOne } = storage;
  const { block, dunestone } = Transaction;

  emitTransferAndBurnEvents(transfers, Transaction, storage);

  let opReturnOutput = pendingUtxos.find((utxo) => utxo.address_id === 2);

  //Burn all dunes from cenotaphs or OP_RETURN outputs (if no cenotaph is present)
  if (dunestone.cenotaph) {
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
  //Filter out all OP_RETURN and zero dune balances. This also removes UTXOS that were in a cenotaph because they will have a balance of 0
  //We still save utxos incase we need to reference them in the future
  //Filter out all OP_RETURN and zero dune balances
  pendingUtxos = pendingUtxos.filter(
    (utxo) =>
      utxo.address_id !== 2 &&
      Object.values(utxo.dune_balances ?? {}).reduce(
        (a, b) => a + BigInt(b),
        0n
      ) > 0n
  );
  //Create all new UTXOs and create a map of their ids (remove all OP_RETURN too as they are burnt). Ignore on cenotaphs
  pendingUtxos.forEach((utxo) => {
    if (utxo.address_id !== 2) {
      let resultUtxo = { ...utxo };
      delete resultUtxo.dune_balances;

      const parentUtxo = create("Utxo", resultUtxo);

      Object.keys(utxo.dune_balances).forEach((duneProtocolId) => {
        if (!utxo.dune_balances[duneProtocolId]) return; //Ignore 0 balances
        create("Utxo_balance", {
          utxo_id: parentUtxo.id,
          dune_id: findOne("Dune", duneProtocolId, false, true).id,
          balance: utxo.dune_balances[duneProtocolId],
        });
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

const handleGenesis = (Transaction, rpc, storage) => {
  processEtching(
    {},
    { ...Transaction, dunestone: GENESIS_DUNESTONE },
    rpc,
    storage,
    true
  );

  return;
};

const processDunestone = (Transaction, rpc, storage, useTest) => {
  const { vout, vin, block, hash } = Transaction;

  const { create, fetchGroupLocally, findOne, local, findOrCreate } = storage;

  //Ignore the coinbase transaction (unless genesis dune is being created)

  //Setup Transaction for processing

  //If the utxo is not in db it was made before GENESIS (840,000) anmd therefore does not contain dunes

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
      dune_balances: balances.reduce((acc, utxoBalance) => {
        acc[
          findOne(
            "Dune",
            utxoBalance.dune_id + "@REF@id",
            false,
            true
          ).dune_protocol_id
        ] = utxoBalance.balance;
        return acc;
      }, {}),
    };
  }).filter(Boolean);

  stopTimer("body_init_utxo_fetch");

  //
  if (
    //If no input utxos are provided (with dunes inside)
    inputUtxos.length === 0 &&
    //AND there is no dunestone field in the transaction (aside from cenotaph)
    Object.keys(Transaction.dunestone).length === 1
  ) {
    //We can return as this transaction will not mint or create new utxos. This saves storage for unrelated transactions
    if (!(vin[0].coinbase && block == GENESIS_BLOCK)) return;
  }

  const parentTransaction = create("Transaction", { hash }, false, true);

  Transaction.virtual_id = parentTransaction.id;
  Transaction.sender =
    //check if it was populated in
    Transaction.sender ??
    //if it wasnt populated in check if its in db froma prev utxo
    findOne("Address", inputUtxos[0]?.address_id + "@REF@id", false, true)
      ?.address ??
    //rip
    "UNKNOWN";

  if (vin[0].coinbase && block === GENESIS_BLOCK)
    handleGenesis(Transaction, rpc, storage);

  startTimer();

  let pendingUtxos = createNewUtxoBodies(vout, Transaction, storage);

  let UnallocatedDunes = getUnallocatedDunesFromUtxos(inputUtxos);

  /*
  Create clone of Unallocated Dunes, this will be used when emitting the "Transfer" event. If the Dune was present in the original
  dunes from vin we have the address indexed on db and can emit the transfer event with the "From" equalling the address of transaction signer.
  However, if the Dune was not present in the original dunes from vin, we can only emit the "From" as "UNALLOCATED" since we dont have the address indexed
  and the dunes in the final Unallocated Dunes Buffer came from the etching or minting process and were created in the transaction.
  */

  //let MappedTransactions = await getParentTransactionsMapFromUtxos(UtxoFilter, db)

  //Delete UTXOs as they are being spent
  // => This should be processed at the end of the block, with filters concatenated.. await Utxo.deleteMany({hash: {$in: UtxoFilter}})

  //Reference of UnallocatedDunes and pendingUtxos is passed around in follwoing functions
  //Process etching is potentially asyncrhnous because of commitment checks
  stopTimer("body_init_pending_utxo_creation");

  startTimer();
  processEtching(UnallocatedDunes, Transaction, rpc, storage, false, useTest);
  stopTimer("etch");

  //Mints are processed next and added to the DuneAllocations, with caps being updated (and burnt in case of cenotaphs)

  startTimer();
  processMint(UnallocatedDunes, Transaction, storage);
  stopTimer("mint");

  //Allocate all transfers from unallocated payload to the pendingUtxos
  startTimer();

  let transfers = {};

  processEdicts(
    UnallocatedDunes,
    pendingUtxos,
    Transaction,
    transfers,
    storage
  );
  stopTimer("edicts");

  //Commit the utxos to storage and update Balances

  startTimer();
  finalizeTransfers(inputUtxos, pendingUtxos, Transaction, transfers, storage);
  stopTimer("transfers");
  return;
};

const loadBlockIntoMemory = async (block, storage) => {
  /*
  Necessary indexes for building (the rest can be built afterwards)

  Transaction -> hash
  Utxo -> ( transaction_id, vout_index )
  Address -> address
  Dune -> dune_protocol_id, raw_name
    Balance -> address_id
  */

  //Events do not need to be loaded as they are purely write and unique

  if (!Array.isArray(block)) {
    console.log(block);
    throw "Non array block passed to loadBlockIntoMemory";
  }

  const { loadManyIntoMemory, local, findOne } = storage;

  //Load all utxos in the block's vin into memory in one call

  startTimer();
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
  stopTimer("load_transaction_hash");

  startTimer();

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

  await loadManyIntoMemory("Utxo", {
    [Op.or]: utxosInBlock.map((utxo) => {
      const { transaction_id, vout_index } = utxo;

      return {
        transaction_id,
        vout_index,
      };
    }),
  });

  stopTimer("load_utxos");

  startTimer();
  const utxoBalancesInBlock = [
    ...new Set(Object.values(local.Utxo).map((utxo) => utxo.id)),
  ];

  await loadManyIntoMemory("Utxo_balance", {
    utxo_id: {
      [Op.in]: utxoBalancesInBlock,
    },
  });

  stopTimer("load_utxo_balances");

  startTimer();

  const utxoBalancesInLocal = local.Utxo_balance;

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

  /*
{
        address: {
          [Op.in]: recipientsInBlock,
        },
      },
*/

  await loadManyIntoMemory("Address", {
    id: {
      [Op.in]: [
        1,
        2,
        3,
        ...Object.values(local.Utxo).map((utxo) => utxo.address_id),
      ],
    },
  });

  await loadManyIntoMemory("Address", {
    address: {
      [Op.in]: recipientsInBlock,
    },
  });

  //load senders
  await loadManyIntoMemory("Address", {
    address: {
      [Op.in]: block.map((transaction) => transaction.sender).filter(Boolean),
    },
  });

  stopTimer("load_addresses");

  startTimer();

  //Get all dune id in all edicts, mints and utxos (we dont need to get etchings as they are created in memory in the block)
  const dunesInBlockByProtocolId = [
    ...new Set(
      [
        //Get all dune ids in edicts and mints

        block.map((transaction) => [
          transaction.dunestone.mint,
          transaction.dunestone.edicts?.map((edict) => edict.id),
        ]),
      ]
        .flat(Infinity)
        //0:0 refers to self, not an actual dune
        .filter((dune) => dune && dune?.dune_protocol_id !== "0:0")
    ),
  ];

  const dunesInBlockByDbId = [
    ...new Set(
      //Get all dune ids in all utxos balance
      Object.values(utxoBalancesInLocal).map((utxo) => utxo.dune_id)
    ),
  ];

  const dunesInBlockByRawName = [
    ...new Set(block.map((transaction) => transaction.dunestone.etching?.dune)),
  ]
    .flat(Infinity)
    //0:0 refers to self, not an actual dune
    .filter((dune) => dune);

  //Load all dunes that might be transferred into memory. This would be every Dune in a mint, edict or etch

  // Load dunes by protocol ID
  await loadManyIntoMemory("Dune", {
    dune_protocol_id: {
      [Op.in]: dunesInBlockByProtocolId,
    },
  });

  // Load dunes by raw name
  await loadManyIntoMemory("Dune", {
    name: {
      [Op.in]: dunesInBlockByRawName,
    },
  });

  // Load dunes by database ID
  await loadManyIntoMemory("Dune", {
    id: {
      [Op.in]: dunesInBlockByDbId,
    },
  });
  stopTimer("load_dunes");

  startTimer();
  const balancesInBlock = [
    ...new Set(
      Object.values(local.Address)
        .map((address) => address.id)
        .filter(Boolean)
    ),
  ];

  //Load the balances of all addresses owning a utxo or in a transactions vout
  await loadManyIntoMemory("Balance", {
    address_id: {
      [Op.in]: balancesInBlock,
    },
  });

  stopTimer("load_balances");
  log(
    "loaded: " + Object.keys(local.Address).length + "  adresses into memory.",
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
    "loaded: " +
      Object.keys(local.Utxo_balance).length +
      "  balances into memory",
    "debug"
  );
  log(
    "loaded: " + Object.keys(local.Dune).length + "  dunes into memory",
    "debug"
  );

  Object.keys(__debug_totalElapsedTime).forEach((field) => {
    log(
      `Time spent on ${field}: ${__debug_totalElapsedTime[field]}ms`,
      "debug"
    );
  });

  __debug_totalElapsedTime = {};

  return;
};

const processBlock = (block, callRpc, storage, useTest) => {
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

      processDunestone(Transaction, callRpc, storage, useTest);
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
          "\ndunestone: " +
          JSON.stringify(Transaction.dunestone) +
          "\ntransaction: " +
          JSON.stringify(Transaction),
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
