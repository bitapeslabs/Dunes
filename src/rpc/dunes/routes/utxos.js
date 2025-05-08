const express = require("express");
const router = express.Router();

router.get("/:address", async function (req, res) {
  try {
    const { db } = req;
    const { Utxo, Address } = db;
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
      return res.send([]); // Return empty list if address not found
    }

    const utxos = await Utxo.findAll({
      raw: true,
      attributes: { exclude: ["createdAt", "updatedAt"] },
      where: {
        address_id: addressRow.id,
      },
    });

    return res.send(utxos);
  } catch (e) {
    console.error(e);
    return res.status(500).send({ error: "Internal server error" });
  }
});

module.exports = router;
