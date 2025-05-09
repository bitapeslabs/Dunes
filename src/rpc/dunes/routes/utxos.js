const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");
const { getSomeUtxoBalance } = require("../lib/queries.js");
const { parseBalancesIntoUtxo } = require("../lib/parsers.js");

router.get("/:address", async (req, res) => {
  try {
    const { db } = req;
    const { Utxo, Address, Transaction } = db;

    const address = await Address.findOne({
      where: { address: req.params.address },
      attributes: ["id"],
    });

    if (!address) {
      res.status(404).json({ error: "Address not found" });
      return;
    }

    const utxos = await Utxo.findAll({
      where: { address_id: address.id, block_spent: null },
      attributes: ["id", "value_sats", "block", "vout_index", "block_spent"],
      include: [
        {
          model: Transaction,
          as: "transaction",
          attributes: ["hash"],
          required: false,
        },
        {
          model: Transaction,
          as: "transaction_spent",
          attributes: ["hash"],
          required: false,
        },
      ],
      order: [["block", "ASC"]],
    });

    const serialized = utxos.map((utxo) => {
      const obj = utxo.toJSON();
      return {
        id: obj.id,
        value_sats: obj.value_sats,
        block: obj.block,
        vout_index: obj.vout_index,
        block_spent: obj.block_spent,
        transaction: obj.transaction?.hash ?? null,
        transaction_spent: obj.transaction_spent?.hash ?? null,
      };
    });

    res.json(serialized);
    return;
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
});

router.get("/balances/:address", async function (req, res) {
  try {
    const { address } = req.params;
    const { db } = req;
    const { Utxo_balance } = db;

    const query = getSomeUtxoBalance(db, {
      utxo: { address: { address }, transaction: { block_spent: null } },
    });

    const balances = (await Utxo_balance.findAll(query))?.map((b) =>
      b.toJSON()
    );

    if (!balances?.length) {
      res.send([]);
      return;
    }
    res.send(balances);
    return;
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Internal server error" });
    return;
  }
});

module.exports = router;
