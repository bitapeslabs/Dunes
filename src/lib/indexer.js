//Test libs
const fs = require("fs");
const path = require("path");
// ======

const { fromBigInt, toBigInt } = require("./tools");

const { Op } = require("sequelize");

const {
  isMintOpen,
  getReservedName,
  updateAllocations,
} = require("./runeutils");

const { SpacedRune, Rune: OrdRune } = require("@ordjs/runestone");

require("dotenv").config({ path: "../../.env" });
const { databaseConnection } = require("../database/createConnection");

//Conversions

const getAccount = async (address, db) => {
  //New runes minted from coinbase, or UTXO is not known
  /*

        The indexer starts keeping track of Utxos at RUNE GENESIS block 840,000. Any utxo before this in the explorer will be seen as genesis for inputs.

        GENESIS UTXOS BY DEFINITION CANNOT HAVE RUNES AND ARE NOT NEEDED FOR INDEXING.

        Any edicts with Genesis as an input should be ignored.
    */
  if (address === "GENESIS") {
    return { id: -1 };
  }

  const { Account } = db;

  let account = await Account.findOne({ where: { address: address } });

  if (account) {
    return account;
  }

  account = await Account.create(
    { address: address },
    {
      address: address,
      utxo_list: "[]",
    }
  );

  return account;
};

const createTransaction = async (Transaction, Account, db) => {
  /*

    Rune Balances:
    {
        rune_id,
        amount
    }
    */

  const { Transactions } = db;

  const { runestone, hash, block, hex, vout, txIndex } = Transaction;

  let transaction = await Transactions.findOne({
    where: { hash: Transaction.hash },
  });

  if (transaction) {
    return transaction;
  }

  let NewTransactionData = {
    block_id: block,
    tx_index: txIndex,
    address_id: Account.id,
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
  };

  transaction = await Transactions.create(NewTransactionData);

  return transaction;
};

const getRuneAllocationsFromUtxos = (InputUtxos) => {
  /*
        Important: Rune Balances from this function are returned in big ints in the following format
        {
            [rune_protocol_id]: BigInt(amount)
        }

        rune_protocol_id => is the rune_id used by the Runes Protocol and is recognized, 
        different from rune_id which is used by the DB for indexing.
    */

  return (
    InputUtxos

      //Get allocated runes and store them in an array
      .reduce((acc, utxo) => {
        let RuneBalances = JSON.parse(utxo.rune_balances);

        //Sum up all Rune balances for each input UTXO
        RuneBalances.forEach((rune) => {
          if (!acc[rune.rune_protocol_id]) {
            acc[rune.rune_protocol_id] = BigInt("0");
          }
          acc[rune.rune_protocol_id] += BigInt(rune.amount);
        });

        return acc;
      }, {})
  );
};

const getParentTransactionsMapFromUtxos = async (UtxoFilter, db) => {
  return (await db.Transactions.findAll({ hash: { $in: UtxoFilter } })).reduce(
    (acc, Transaction) => {
      acc[Transaction.hash] = Transaction;
      return acc;
    },
    {}
  );
};

const createNewUtxoBodies = (vout, MappedTransactions, SpenderAccount) => {
  return vout.map((utxo, index) => {
    return {
      account: SpenderAccount.id,
      transaction_id: MappedTransactions[utxo.hash]?.id ?? -1,
      value_sats: toBigInt(utxo.value.toString(), 8),
      hash: utxo.hash,
      vout_index: index,
      rune_balances: {},
    };
  });
};

const processMint = async (InputAllocations, Transaction, db) => {
  const { block, txIndex, runestone } = Transaction;
  const { mint } = runestone;

  const { Rune } = db;

  if (!mint) {
    console.log("no mint");

    return InputAllocations;
  }
  //We use the same  process used to calculate the Rune Id in the etch function if "0:0" is referred to
  const runeToMint = await Rune.findOne({
    where: {
      rune_protocol_id: mint === "0:0" ? `${block}:${txIndex}` : mint,
    },
  });

  if (!runeToMint) {
    //The rune requested to be minted does not exist.
    console.log("rune does not exist");
    return InputAllocations;
  }

  if (isMintOpen(block, runeToMint, true)) {
    //Update new mints to count towards cap
    runeToMint.mints = BigInt(runeToMint.mints) + BigInt(1);
    await runeToMint.save();

    if (runestone.cenotaph) {
      //If the mint is a cenotaph, the minted amount is burnt
      return InputAllocations;
    }

    return updateAllocations(InputAllocations, {
      rune_id: runeToMint.rune_protocol_id,
      amount: BigInt(runeToMint.mint_amount),
    });
  } else {
    //Minting is closed
    console.log("mint closed");
    return InputAllocations;
  }
};

const processEtching = async (InputAllocations, Transaction, db) => {
  const { block, txIndex, runestone } = Transaction;

  const { etching } = runestone;

  const { Rune } = db;

  //If no etching, return the input allocations
  if (!runestone.etching) {
    return InputAllocations;
  }
  //If rune name already taken, it is non standard, return the input allocations

  //Check if a rune name was provided, and if not, generate one
  let runeName = etching.rune ?? getReservedName(block, txIndex);

  let spacedRune;

  if (etching.spacers) {
    spacedRune = new SpacedRune(OrdRune.fromString(runeName), etching.spacers);
  }

  const isRuneNameTaken = await Rune.findOne({
    where: { name: spacedRune.name },
  });

  if (isRuneNameTaken) {
    return InputAllocations;
  }

  /*
    Runespec: Runes etched in a transaction with a cenotaph are set as unmintable.

    If the runestone decoded has the cenotaph flag set to true, the rune should be created with no allocationg created

    see unminable flag in rune model
  */

  const EtchedRune = await Rune.create({
    rune_protocol_id: `${block}:${txIndex}`,
    name: spacedRune ? spacedRune.name : runeName,
    raw_name: runeName,
    symbol: etching.symbol ?? "¤",
    spacers: etching.spacers ?? 0,

    //ORD describes no decimals being set as default 0
    decimals: etching.divisibility ?? 0,

    total_supply: etching.premine ?? 0,
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
    return InputAllocations;
  }

  return updateAllocations(InputAllocations, {
    rune_id: EtchedRune.rune_protocol_id,
    amount: BigInt(etching.premine),
  });
};

const processRunestone = async (Transaction, db) => {
  const { runestone, hash, vout, vin } = Transaction;

  const {
    Account,
    Balance,
    Rune,
    Runestone: RunestoneModel,
    Transactions,
    Utxo,
  } = db;

  // const SpenderAccount = await _getAccount(Transaction, db)

  let UtxoFilter = vin.map((vin) => vin.txid);

  //Setup Transaction for processing
  let InputUtxos = await Utxo.findAll({
    where: { hash: { [Op.in]: UtxoFilter } },
  });
  let SpenderAccount = await getAccount(
    InputUtxos[0]?.address ?? "GENESIS",
    db
  );
  let RuneAllocations = getRuneAllocationsFromUtxos(InputUtxos);
  //let MappedTransactions = await getParentTransactionsMapFromUtxos(UtxoFilter, db)

  //Create A New Transaction to store UTXOs
  let NewTransaction = await createTransaction(Transaction, SpenderAccount, db);

  let NewUtxos = createNewUtxoBodies(vout, "", SpenderAccount);

  //Delete UTXOs as they are being spent
  // => This should be processed at the end of the block, with filters concatenated.. await Utxo.deleteMany({hash: {$in: UtxoFilter}})

  RuneAllocations = await processEtching(RuneAllocations, Transaction, db);

  //Mints are processed next and added to the RuneAllocations, with caps being updated (and burnt in case of cenotaphs)

  RuneAllocations = await processMint(RuneAllocations, Transaction, db);

  //TODO: process edicts (and include processing with the pointer field)
  console.log(RuneAllocations);
};

const testEdictRune = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../../dumps/testEdictRune.json"),
    "UTF-8"
  )
);

const test = async () => {
  const db = await databaseConnection();

  //const rune = await db.Rune.findOne({where: {name: 'FIAT•IS•HELL•MONEY'}})
  //console.log(isMintOpen(844000, rune))

  processRunestone(testEdictRune, db);
};

test();

module.exports = processRunestone;
