const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");

router.get("/:address", async (req, res) => {
  try {
    const { db } = req;
    const { Utxo, Address, Transaction } = db;

    const address = await Address.findOne({
      where: { address: req.params.address },
      attributes: ["id"],
    });

    if (!address) {
      return res.status(404).json({ error: "Address not found" });
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

    return res.json(serialized);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
