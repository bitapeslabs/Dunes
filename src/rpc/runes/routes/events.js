const express = require("express");
const router = express.Router();
const bitcoin = require("bitcoinjs-lib");
const { Op } = require("sequelize");
const ecc = require("tiny-secp256k1");

// Initialize the ECC library
bitcoin.initEccLib(ecc);
/*
    Gets all Rune events from a specific block
    
    Documentation: https://nanas.sh/docs/runes-rpc/events#get-runes-block-height
*/

const validators = {
  validBlockHeight: (height) => {
    return !(isNaN(height) || height < 0);
  },
  validTransactionHash: (hash) => {
    const regex = /^[a-fA-F0-9]{64}$/;

    // Test the txHash against the regex
    return regex.test(hash);
  },

  validBitcoinAddress: (address) => {
    try {
      bitcoin.address.toOutputScript(address);
      return true;
    } catch (e) {
      console.log(e);
      return false;
    }
  },
};

router.get("/block/:height", async function (req, res) {
  const { db } = req;

  const { Event } = db;

  const { validBlockHeight } = validators;

  const blockHeight = parseInt(req.params.height, 10);

  if (!validBlockHeight(blockHeight)) {
    return res.status(400).send({ error: "Invalid block height provided" });
  }

  try {
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
    return res.status(500);
  }
});

/*
    Gets all Rune events from a specific transaction
    
    Documentation: https://nanas.sh/docs/runes-rpc/events#get-runes-block-height
*/
router.get("/tx/:hash", async function (req, res) {
  const { db } = req;

  const { Event } = db;

  const { validTransactionHash } = validators;

  if (!validTransactionHash(req.params.hash)) {
    return res.status(400).send({ error: "Invalid transaction hash provided" });
  }

  try {
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
    return res.status(500);
  }
});

/*
    Gets all Rune events from a specific transaction
    
    Documentation: https://nanas.sh/docs/runes-rpc/events#get-runes-block-height
*/
router.get("/address/:address", async function (req, res) {
  const { db } = req;

  const { Event } = db;

  const { validBitcoinAddress } = validators;

  if (!validBitcoinAddress(req.params.address)) {
    return res.status(400).send({ error: "Invalid address provided" });
  }

  try {
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
    return res.status(500);
  }
});

module.exports = router;
