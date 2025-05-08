const express = require("express");
const router = express.Router();

router.get("/utxos/:address", async function (req, res) {
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
      raw: true,
      attributes: {
        exclude: ["createdAt", "updatedAt"],
      },
      where: {
        address_id: addressRow.id,
      },
      include: [
        {
          model: Transaction,
          as: "transaction",
          attributes: ["hash"],
        },
        {
          model: Transaction,
          as: "transaction_spent",
          attributes: ["hash"],
        },
      ],
    });

    // Rename fields to match desired response
    const result = utxos.map((utxo) => ({
      ...utxo,
      transaction: utxo["transaction.hash"] ?? null,
      transaction_spent: utxo["transaction_spent.hash"] ?? null,
    }));

    return res.send(result);
  } catch (e) {
    console.error(e);
    return res.status(500).send({ error: "Internal server error" });
  }
});

module.exports = router;
