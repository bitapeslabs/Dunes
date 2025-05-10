const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");

const { simplify } = require("../../../lib/utils");

router.get("/info/:duneid", async (req, res) => {
  const { duneid } = req.params;

  // Validate "block:tx" (both u32)
  const idParts = duneid.split(":");
  if (
    idParts.length !== 2 ||
    !/^\d+$/.test(idParts[0]) ||
    !/^\d+$/.test(idParts[1]) ||
    Number(idParts[0]) > 0xffffffff ||
    Number(idParts[1]) > 0xffffffff
  ) {
    res.status(400).json({ error: "Invalid duneid format (block:tx)" });
    return;
  }

  try {
    const { db } = req;
    const { Dune, Transaction, Address } = db;

    // pull dune + etch tx + deployer address
    const dune = await Dune.findOne({
      where: { dune_protocol_id: duneid },
      attributes: {
        exclude: ["etch_transaction_id", "deployer_address_id", "id"],
      },
      include: [
        {
          model: Transaction,
          as: "etch_transaction",
          attributes: ["hash"],
          required: false,
        },
        {
          model: Address,
          as: "deployer_address",
          attributes: ["address"],
          required: false,
        },
      ],
    });

    if (!dune) {
      res.status(404).json({ error: "Dune not found" });
      return;
    }

    const d = dune.toJSON();

    // Ensure output matches the TypeScript interface keys
    res.json(simplify(d));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
});

module.exports = router;
