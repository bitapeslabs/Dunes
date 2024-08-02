const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");
const validators = require("../lib/validators");

/*
    Gets all Runes owned by a specific utxo (could be spent or unspent)
*/
const getRunesDataFromArray = async (db, arr) => {
  const { Rune } = db;

  let runes = await Rune.findAll({
    raw: true,
    attributes: { exclude: ["createdAt", "updatedAt"] },
    where: {
      rune_protocol_id: {
        [Op.in]: arr,
      },
    },
  });

  return runes.reduce((acc, row) => {
    acc[row.rune_protocol_id] = row;

    return acc;
  }, {});
};

router.get("/utxo/:utxo_index", async function (req, res) {
  try {
    const { db } = req;

    const { Utxo } = db;

    const { validTransactionHash, validInt } = validators;

    if (!req.params.utxo_index.includes(":")) {
      return res.status(400).send({ error: "Invalid utxo index provided" });
    }

    const [txHash, vout] = req.params.utxo_index.split(":");

    if (!validTransactionHash(txHash) || !validInt(vout)) {
      return res.status(400).send({ error: "Invalid utxo index provided" });
    }
    const utxo = await Utxo.findOne({
      raw: true,
      attributes: { exclude: ["createdAt", "updatedAt"] },
      where: {
        utxo_index: `${req.params.utxo_index}`,
      },
    });

    if (!utxo) return res.send({});

    utxo.rune_balances = JSON.parse(utxo.rune_balances);

    return res.send({
      utxo,
      runes: await getRunesDataFromArray(db, Object.keys(utxo.rune_balances)),
    });
  } catch (e) {
    console.log(e);
    return res.status(500).send({ error: "Internal server error" });
  }
});

router.get("/address/:address", async function (req, res) {
  try {
    const { db } = req;

    const { Balance, Rune } = db;

    const { validBitcoinAddress } = validators;

    if (!validBitcoinAddress(req.params.address)) {
      return res.status(400).send({ error: "Invalid address provided" });
    }
    let balances = await Balance.findAll({
      raw: true,
      attributes: { exclude: ["createdAt", "updatedAt"] },
      where: {
        address: `${req.params.address}`,
      },
    });

    if (!balances.length) return res.send({});

    balances = balances.reduce((acc, row) => {
      acc[row.rune_protocol_id] = row.balance;

      return acc;
    }, {});

    return res.send({
      balances,
      runes: await getRunesDataFromArray(db, Object.keys(balances)),
    });
  } catch (e) {
    console.log(e);
    return res.status(500).send({ error: "Internal server error" });
  }
});

module.exports = router;
