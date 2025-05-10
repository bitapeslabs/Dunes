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

// …require lines & existing /info route above …

// GET /holders/:duneid  – paginated list of addresses + balances
router.get("/holders/:duneid", async (req, res) => {
  const { duneid } = req.params;

  /** @type {any} */
  let queryPage = req.query.page;
  /** @type {any} */
  let queryLimit = req.query.limit;

  const page = Math.max(parseInt(queryPage) || 1, 1);
  const limit = Math.min(Math.max(parseInt(queryLimit) || 100, 1), 500);
  const offset = (page - 1) * limit;

  // basic duneid validation (block:tx u32:u32)
  const [blk, tx] = duneid.split(":");
  if (
    !blk ||
    !tx ||
    !/^\d+$/.test(blk) ||
    !/^\d+$/.test(tx) ||
    Number(blk) > 0xffffffff ||
    Number(tx) > 0xffffffff
  ) {
    res.status(400).json({ error: "Invalid duneid format (block:tx)" });
    return;
  }

  try {
    const { db } = req;
    const { Dune, Balance, Address } = db;

    // resolve dune row to get internal id
    const duneRow = await Dune.findOne({
      where: { dune_protocol_id: duneid },
      attributes: ["id"],
    });
    if (!duneRow) {
      res.status(404).json({ error: "Dune not found" });
      return;
    }

    // total holders (balance > 0)
    const total_holders = await Balance.count({
      where: { dune_id: duneRow.id, balance: { [Op.gt]: 0 } },
    });

    // page results
    const rows = await Balance.findAll({
      where: { dune_id: duneRow.id, balance: { [Op.gt]: 0 } },
      include: [
        {
          model: Address,
          as: "address",
          attributes: ["address"],
          required: true,
        },
      ],
      order: [["balance", "DESC"]],
      limit,
      offset,
      attributes: ["balance"],
    });

    const holders = rows.map((b) => ({
      address: b.address.address,
      balance: b.balance,
    }));

    res.json({ total_holders, page, limit, holders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
