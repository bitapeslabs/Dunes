const express = require("express");
const router = express.Router();
const { Op, Sequelize } = require("sequelize");
const {
  process_many_utxo_balances,
} = require("../lib/native/pkg/nana_parsers.js");
const validators = require("../lib/validators.js");
const {
  parseBalancesIntoUtxo,
  parseBalancesIntoAddress,
} = require("../lib/parsers.js");

const {
  getSomeUtxoBalance,
  getSomeAddressBalance,
} = require("../lib/queries.js");

router.get("/utxo/:utxo_index", async function (req, res) {
  try {
    const { db } = req;

    const { Utxo_balance } = db;

    const { validTransactionHash, validInt } = validators;

    const [hash, vout] = req.params.utxo_index?.split(":");

    if (!validTransactionHash(hash) || !validInt(vout)) {
      return res.status(400).send({ error: "Invalid utxo index provided" });
    }

    let query = getSomeUtxoBalance(db, {
      utxo: { transaction: { hash }, vout_index: vout },
    });

    const utxoBalances = (await Utxo_balance.findAll(query))?.map((balance) =>
      balance.toJSON()
    );

    if (!utxoBalances?.length) return res.send({ error: "No UTXO found" });

    let parsed = parseBalancesIntoUtxo(utxoBalances);

    return res.send(parsed);
  } catch (e) {
    console.log(e);
    return res.status(500).send({ error: "Internal server error" });
  }
});

router.get("/utxo/:utxo_index/:dune_protocol_id", async function (req, res) {
  try {
    const { db } = req;

    const { Utxo_balance } = db;

    const { validTransactionHash, validInt, validProtocolId } = validators;

    const { dune_protocol_id, utxo_index } = req.params;

    const [hash, vout] = utxo_index?.split(":");

    if (!validTransactionHash(hash) || !validInt(vout)) {
      return res.status(400).send({ error: "Invalid utxo index provided" });
    }

    if (!validProtocolId(req.params.dune_protocol_id)) return res;

    let query = getSomeUtxoBalance(db, {
      utxo: {
        transaction: { hash },
        vout_index: vout,
      },
      dune: { dune_protocol_id },
    });

    const utxoBalances = (await Utxo_balance.findAll(query))?.map((balance) =>
      balance.toJSON()
    );

    if (!utxoBalances?.length) return res.send({ error: "No UTXO found" });

    let parsed = parseBalancesIntoUtxo(utxoBalances);

    return res.send(parsed);
  } catch (e) {
    console.log(e);
    return res.status(500).send({ error: "Internal server error" });
  }
});

router.get("/address/:address", async function (req, res) {
  try {
    let { db } = req;

    let { Balance } = db;

    let { address } = req.params;

    const { validBitcoinAddress } = validators;

    //if dune_protocol_id is "0" or undefined, then we want to get all balances for the address
    //if block is "0" or undefined, then we want to get the latest balance for the address

    if (!validBitcoinAddress(address))
      return res.status(400).send({ error: "Invalid address provided" });

    let query = getSomeAddressBalance(db, { address: { address } });

    let balances = (await Balance.findAll(query))?.map((balance) =>
      balance.toJSON()
    );

    if (!balances?.length) return res.send({});

    res.send(parseBalancesIntoAddress(balances));
  } catch (e) {
    console.log(e);
    return res.status(500).send({ error: "Internal server error" });
  }
});

router.get("/address/:address/:dune_protocol_id", async function (req, res) {
  try {
    let { db } = req;

    let { Balance } = db;

    let { address, dune_protocol_id } = req.params;

    const { validBitcoinAddress, validProtocolId } = validators;

    //if dune_protocol_id is "0" or undefined, then we want to get all balances for the address
    //if block is "0" or undefined, then we want to get the latest balance for the address

    if (!validBitcoinAddress(address))
      return res.status(400).send({ error: "Invalid address provided" });

    if (!validProtocolId(dune_protocol_id))
      return res
        .status(400)
        .send({ error: "Invalid dune protocol id provided" });

    let query = getSomeUtxoBalance(db, {
      address: { address },
      dune: { dune_protocol_id },
    });

    let balances = (await Balance.findAll(query))?.map((balance) =>
      balance.toJSON()
    );

    if (!balances?.length) return res.send({});

    res.send(parseBalancesIntoAddress(balances));
  } catch (e) {
    console.log(e);
    return res.status(500).send({ error: "Internal server error" });
  }
});

//Snapshot api below (get what balance was for an address or utxo at a specific block)

router.get(
  "/snapshot/:start_block/:end_block/address/:address",
  async function (req, res) {
    try {
      let { db } = req;

      let { Utxo_balance } = db;

      let { address, start_block, end_block } = req.params;

      const { validBitcoinAddress, validInt } = validators;

      //if dune_protocol_id is "0" or undefined, then we want to get all balances for the address
      //if block is "0" or undefined, then we want to get the latest balance for the address

      if (!validBitcoinAddress(address))
        return res.status(400).send({ error: "Invalid address provided" });
      if (!validInt(start_block))
        return res.status(400).send({ error: "Invalid block provided" });
      if (!validInt(end_block))
        return res.status(400).send({ error: "Invalid block provided" });

      let query = getSomeUtxoBalance(db, {
        utxo: {
          address: { address },
          block: {
            [Op.lte]: parseInt(end_block),
          },
        },
      });

      let balances = (await Utxo_balance.findAll(query))?.map((balance) =>
        balance.toJSON()
      );

      if (!balances?.length) return res.send({});

      res.send(
        JSON.parse(
          process_many_utxo_balances(
            JSON.stringify(balances),
            parseInt(start_block),
            parseInt(end_block)
          )
        )
      );
    } catch (e) {
      console.log(e);
      return res.status(500).send({ error: "Internal server error" });
    }
  }
);

router.get(
  "/snapshot/:start_block/:end_block/address/:address/:dune_protocol_id",
  async function (req, res) {
    try {
      let { db } = req;

      let { Utxo_balance } = db;

      let { address, start_block, end_block, dune_protocol_id } = req.params;

      const { validBitcoinAddress, validInt, validProtocolId } = validators;

      //if dune_protocol_id is "0" or undefined, then we want to get all balances for the address
      //if block is "0" or undefined, then we want to get the latest balance for the address

      if (!validBitcoinAddress(address))
        return res.status(400).send({ error: "Invalid address provided" });
      if (!validInt(start_block))
        return res.status(400).send({ error: "Invalid block provided" });
      if (!validInt(end_block))
        return res.status(400).send({ error: "Invalid block provided" });
      if (!validProtocolId(dune_protocol_id))
        return res
          .status(400)
          .send({ error: "Invalid dune protocol id provided" });

      let query = getSomeUtxoBalance(db, {
        utxo: {
          address: { address },
          block: {
            [Op.lte]: parseInt(end_block),
          },
        },
        dune: {
          dune_protocol_id,
        },
      });

      let balances = (await Utxo_balance.findAll(query))?.map((balance) =>
        balance.toJSON()
      );

      if (!balances?.length) return res.send({});

      res.send(
        JSON.parse(
          process_many_utxo_balances(
            JSON.stringify(balances),
            parseInt(start_block),
            parseInt(end_block)
          )
        )
      );
    } catch (e) {
      console.log(e);
      return res.status(500).send({ error: "Internal server error" });
    }
  }
);

module.exports = router;
