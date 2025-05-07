const express = require("express");
const router = express.Router();
const validators = require("../lib/validators");
const { Op } = require("sequelize");

/*
    Gets all Rune events from a specific block
    
    Documentation: https://dunes.sh/docs/runes-rpc/events#get-runes-block-height
*/

router.get("/block/:height", async function (req, res) {
  try {
    const { db } = req;

    const { Event } = db;

    const { validInt } = validators;

    const blockHeight = parseInt(req.params.height, 10);

    if (!validInt(blockHeight)) {
      return res.status(400).send({ error: "Invalid block height provided" });
    }

    const events = await Event.findAll({
      raw: true,
      attributes: { exclude: ["createdAt", "updatedAt"] },
      where: {
        block: blockHeight,
      },
    });

    return res.send(events);
  } catch (e) {
    console.log(e);
    return res.status(500).send({ error: "Internal server error" });
  }
});

/*
    Gets all Rune events from a specific transaction
    
    Documentation: https://dunes.sh/docs/runes-rpc/events#get-runes-block-height
*/
router.get("/tx/:hash", async function (req, res) {
  try {
    const { db } = req;

    const { Event } = db;

    const { validTransactionHash } = validators;

    if (!validTransactionHash(req.params.hash)) {
      return res
        .status(400)
        .send({ error: "Invalid transaction hash provided" });
    }

    const events = await Event.findAll({
      raw: true,
      attributes: { exclude: ["createdAt", "updatedAt"] },
      where: {
        transaction_hash: req.params.hash,
      },
    });

    return res.send(events);
  } catch (e) {
    console.log(e);
    return res.status(500).send({ error: "Internal server error" });
  }
});

/*
    Gets all Rune events from a specific transaction
    
    Documentation: https://dunes.sh/docs/runes-rpc/events#get-runes-block-height
*/
router.get("/address/:address", async function (req, res) {
  try {
    const { db } = req;

    const { Event } = db;

    const { validBitcoinAddress } = validators;

    if (!validBitcoinAddress(req.params.address)) {
      return res.status(400).send({ error: "Invalid address provided" });
    }

    const events = await Event.findAll({
      raw: true,
      attributes: { exclude: ["createdAt", "updatedAt"] },
      where: {
        [Op.or]: [
          { from_address: req.params.address },
          { to_address: req.params.address },
        ],
      },
    });

    return res.send(events);
  } catch (e) {
    console.log(e);
    return res.status(500).send({ error: "Internal server error" });
  }
});

module.exports = router;
