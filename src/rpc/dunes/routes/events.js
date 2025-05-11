const express = require("express");
const router = express.Router();
const { Op, col, where } = require("sequelize");
const validators = require("../lib/validators");

router.get("/block/:height", async (req, res) => {
  try {
    const { db } = req;
    const { Event } = db;
    const { validInt } = validators;
    const { height } = req.params;

    const blockHeight = parseInt(height, 10);
    if (!validInt(blockHeight)) {
      res.status(400).send({ error: "Invalid block height provided" });
      return;
    }

    const events = await Event.findAll({
      raw: true,
      attributes: { exclude: ["createdAt", "updatedAt"] },
      where: { block: blockHeight },
    });

    res.send(events);
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: "Internal server error" });
  }
});

router.get("/tx/:hash", async (req, res) => {
  try {
    const { db } = req;
    const { Event } = db;
    const { validTransactionHash } = validators;
    const { hash } = req.params;

    if (!validTransactionHash(hash)) {
      res.status(400).send({ error: "Invalid transaction hash provided" });
      return;
    }

    const events = await Event.findAll({
      raw: true,
      attributes: { exclude: ["createdAt", "updatedAt"] },
      where: { transaction_hash: hash },
    });

    res.send(events);
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: "Internal server error" });
  }
});

router.get("/address/:address", async (req, res) => {
  const { db } = req;
  const { Event, Address } = db;
  const { address } = req.params;

  try {
    const events = await Event.findAll({
      attributes: { exclude: ["createdAt", "updatedAt"] },

      include: [
        {
          model: Address,
          as: "from_address", // ← alias exactly as in the association
          attributes: ["address"],
          required: false,
        },
        {
          model: Address,
          as: "to_address", // ← alias exactly as in the association
          attributes: ["address"],
          required: false,
        },
      ],

      where: {
        [Op.or]: [
          where(col("from_address.address"), address),
          where(col("to_address.address"), address),
        ],
      },

      raw: true,
      nest: true,
    });

    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});
module.exports = router;
