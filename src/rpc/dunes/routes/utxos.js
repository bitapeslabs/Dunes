const express = require("express");
const router = express.Router();

rourouter.get("/utxos/:address", async function (req, res) {
  try {
    const { db } = req;
    const { Utxo, Address, Transaction } = db;

    const addressText = req.params.address;

    if (typeof addressText !== "string" || addressText.length > 130) {
      return res.status(400).send({ error: "Invalid address format" });
    }

    const addressRow = await Address.findOne({
      where: { address: addressText },
      attributes: ["id"],
      raw: true,
    });

    if (!addressRow) {
      return res.send([]);
    }

    const utxos = await Utxo.findAll({
      attributes: ["id", "value_sats", "block", "vout_index", "block_spent"],
      where: {
        address_id: addressRow.id,
      },
      include: [
        {
          model: Transaction,
          as: "transaction",
          attributes: [["hash", "transaction"]],
          required: false,
        },
        {
          model: Transaction,
          as: "transaction_spent",
          attributes: [["hash", "transaction_spent"]],
          required: false,
        },
      ],
      raw: true,
    });

    // Format response to use flat keys and drop internal joins
    const result = utxos.map((utxo) => ({
      id: utxo.id,
      value_sats: utxo.value_sats,
      block: utxo.block,
      vout_index: utxo.vout_index,
      block_spent: utxo.block_spent,
      transaction: utxo.transaction ?? null,
      transaction_spent: utxo.transaction_spent ?? null,
    }));

    return res.send(result);
  } catch (e) {
    console.error(e);
    return res.status(500).send({ error: "Internal server error" });
  }
});

module.exports = router;
