const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");

const { simplify } = require("../../../lib/utils");
const { resolveDune } = require("../lib/resolvers");

// ───────────────────────────────────────────────
// GET /info/:identifier
// ───────────────────────────────────────────────
router.get("/info/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    const { Dune, Transaction, Address } = req.db;

    const duneRow = await resolveDune(Dune, identifier);
    if (!duneRow) {
      res.status(404).json({ error: "Dune not found" });
      return;
    }

    const dune = await Dune.findOne({
      where: { id: duneRow.id },
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

    res.status(200).json(simplify(dune.toJSON()));
    return;
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
});

// ───────────────────────────────────────────────
// GET /holders/:identifier
// ───────────────────────────────────────────────
router.get("/holders/:identifier", async (req, res) => {
  const { identifier } = req.params;

  /** @type {any} */
  let queryPage = req.query.page;

  /** @type {any} */
  let queryLimit = req.query.limit;

  const page = Math.max(parseInt(queryPage) || 1, 1);
  const limit = Math.min(Math.max(parseInt(queryLimit) || 100, 1), 500);
  const offset = (page - 1) * limit;

  try {
    const { Dune, Balance, Address } = req.db;

    const duneRow = await resolveDune(Dune, identifier);
    if (!duneRow) {
      res.status(404).json({ error: "Dune not found" });
      return;
    }

    const total_holders = await Balance.count({
      where: { dune_id: duneRow.id, balance: { [Op.gt]: 0 } },
    });

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

    res.status(200).json({ total_holders, page, limit, holders });
    return;
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
});

module.exports = router;
