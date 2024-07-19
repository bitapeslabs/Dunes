const express = require("express");
const router = express.Router();
const { getRunestonesInBlock } = require("../lib/runeutils");
const fs = require("fs");
const path = require("path");

router.get("/headers/:id", async function (req, res) {
  const { callRpc } = req;

  const blockHeight = parseInt(req.params.id, 10);

  // Check if the conversion was successful
  if (isNaN(blockHeight) || blockHeight < 0) {
    return res.status(400).send({ error: "Invalid block height" });
  }
  const blockHash = await callRpc("getblockhash", [blockHeight]);
  const blockHeaders = await callRpc("getblockheader", [blockHash]);
  res.send(blockHeaders);
});

router.get("/runestones/:id", async function (req, res) {
  const { callRpc } = req;
  const blockHeight = parseInt(req.params.id, 10);

  if (isNaN(blockHeight) || blockHeight < 0) {
    return res.status(400).send({ error: "Invalid block height" });
  }

  const runestones = await getRunestonesInBlock(req.params.id, callRpc);

  // FOR TESTING
  fs.writeFileSync(
    path.join(__dirname, "../../dumps/runestones_" + blockHeight + ".json"),
    JSON.stringify(runestones, null, 2)
  );
  //

  res.send(runestones);
});

router.get("/tx/:id", async function (req, res) {
  const { callRpc } = req;

  const txHash = req.params.id;
  const tx = await callRpc("getrawtransaction", [txHash, false]);
  res.send(tx);
});

router.get("/:id", async function (req, res) {
  const { callRpc } = req;

  const blockHeight = parseInt(req.params.id, 10);

  // Check if the conversion was successful
  if (isNaN(blockHeight) || blockHeight < 0) {
    return res.status(400).send({ error: "Invalid block height" });
  }

  const blockHash = await callRpc("getblockhash", [parseInt(blockHeight)]);

  const transactions = await callRpc("getblock", [blockHash, 2]);

  fs.writeFileSync(
    "block_" + blockHeight + ".json",
    JSON.stringify(transactions, null, 2)
  );
  res.send(transactions);
});

module.exports = router;
