const express = require("express");
const router = express.Router();
const { Op, col, where } = require("sequelize");
const validators = require("../lib/validators");
const { simplify } = require("../../../lib/utils");

const types = {
  0: "ETCH",
  1: "MINT",
  2: "TRANSFER",
  3: "BURN",
};

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

  /** @type {any} */
  let queryPage = req.query.page;

  /** @type {any} */
  let queryLimit = req.query.limit;

  // current page (1‑based)
  const page = Math.max(parseInt(queryPage, 10) || 1, 1);

  // rows per page, default 25, min 1, max 500
  const pageSize = Math.min(Math.max(parseInt(queryLimit, 10) || 25, 1), 500);

  const offset = (page - 1) * pageSize;

  try {
    const { rows, count } = await Event.findAndCountAll({
      limit: pageSize,
      offset,

      attributes: { exclude: ["createdAt", "updatedAt"] },

      include: [
        {
          model: Address,
          as: "from_address",
          attributes: ["address"],
          required: false,
        },
        {
          model: Address,
          as: "to_address",
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

    const data = rows.map((row) => simplify({ ...row, type: types[row.type] }));

    res.json({
      page,
      pageSize,
      total: count,
      totalPages: Math.ceil(count / pageSize),
      data,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});
