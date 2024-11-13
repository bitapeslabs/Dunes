const express = require("express");
const router = express.Router();
const validators = require("../lib/validators");
const { Op } = require("sequelize");

/*
    Gets all Rune events from a specific block
    
    Documentation: https://nanas.sh/docs/runes-rpc/events#get-runes-block-height
*/
/*
    Gets all Rune events from a specific transaction
    
    Documentation: https://nanas.sh/docs/runes-rpc/events#get-runes-block-height
*/
router.get("/info", async function (req, res) {
  try {
    const { db } = req;

    const { Setting } = db;

    const settings = await Setting.findAll({
      raw: true,
      attributes: { exclude: ["id"] },
    });

    return res.send(settings);
  } catch (e) {
    console.log(e);
    return res.status(500).send({ error: "Internal server error" });
  }
});

module.exports = router;
