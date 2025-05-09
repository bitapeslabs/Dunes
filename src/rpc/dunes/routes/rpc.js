const express = require("express");
const router = express.Router();

/*
  Returns global Dune RPC settings

  Documentation: https://dunes.sh/docs/dunes-rpc/events#get-dunes-info
*/
router.get("/info", async (req, res) => {
  try {
    const { db } = req;
    const { Setting } = db;

    const settings = await Setting.findAll({
      raw: true,
      attributes: { exclude: ["id"] },
    });

    res.send(settings);
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: "Internal server error" });
  }
});

module.exports = router;
