/* eslint‑disable @typescript-eslint/explicit-function-return-type */

import { Router, Request, Response } from "express";
import { Op, col, where, WhereOptions } from "sequelize";

import { validators } from "../lib/validators"; // ← FIX #1
import { simplify } from "../../../lib/utils";
import { Models, IEvent, IAddress } from "@/database/createConnection";

const router = Router();

const TYPE_LABEL: Record<0 | 1 | 2 | 3, "ETCH" | "MINT" | "TRANSFER" | "BURN"> =
  {
    0: "ETCH",
    1: "MINT",
    2: "TRANSFER",
    3: "BURN",
  };

/* ───────────────────── GET /block/:height ───────────────────── */

router.get("/block/:height", async (req: Request, res: Response) => {
  try {
    const heightNum = Number.parseInt(req.params.height, 10);
    if (!validators.validInt(heightNum)) {
      res.status(400).json({ error: "Invalid block height provided" });
      return;
    }

    const events = (await req.db.Event.findAll({
      raw: true,
      attributes: { exclude: ["createdAt", "updatedAt"] },
      where: { block: heightNum } as WhereOptions<IEvent>,
    })) as IEvent[];

    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ───────────────────── GET /tx/:hash ────────────────────────── */

router.get("/tx/:hash", async (req: Request, res: Response) => {
  try {
    const { hash } = req.params;
    if (!validators.validTransactionHash(hash)) {
      res.status(400).json({ error: "Invalid transaction hash provided" });
      return;
    }

    const events = (await req.db.Event.findAll({
      raw: true,
      attributes: { exclude: ["createdAt", "updatedAt"] },
      // Event’s TS interface doesn’t include `transaction_hash`
      // so we cast the literal to `WhereOptions<any>`
      where: { transaction_hash: hash } as WhereOptions<any>, // ← FIX #2
    })) as IEvent[];

    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ───────────────────── GET /address/:addr ───────────────────── */

router.get("/address/:address", async (req: Request, res: Response) => {
  const { address } = req.params;

  const page = Math.max(parseInt(String(req.query.page), 10) || 1, 1);
  const limit = Math.min(
    Math.max(parseInt(String(req.query.limit), 10) || 25, 1),
    500
  );
  const offset = (page - 1) * limit;

  try {
    const { Event, Address, Transaction, Mezcal } = req.db;

    const { rows, count } = await Event.findAndCountAll({
      limit,
      offset,
      order: [["id", "DESC"]],
      attributes: {
        exclude: [
          "createdAt",
          "updatedAt",
          "from_address_id",
          "to_address_id",
          "transaction_id",
          "mezcal_id", // 🆕 exclude FK
        ],
      },
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
        {
          model: Transaction,
          as: "transaction",
          attributes: { exclude: ["id", "createdAt", "updatedAt"] }, // 🆕 no id
          required: false,
        },
        {
          model: Mezcal,
          as: "mezcal", // 🆕 full mezcal object
          attributes: { exclude: ["createdAt", "updatedAt"] },
          required: false,
        },
      ],
      where: {
        [Op.or]: [
          where(col("from_address.address"), address),
          where(col("to_address.address"), address),
        ],
        [Op.and]: [
          where(col("from_address.address"), {
            [Op.ne]: col("to_address.address"),
          }),
        ],
      } as any,
      raw: true,
      nest: true,
    });

    const data = (rows as any[]).map((row) =>
      simplify({
        ...row,
        type: TYPE_LABEL[(row as IEvent).type as 0 | 1 | 2 | 3],
      })
    );

    res.json({
      page,
      pageSize: limit,
      total: count,
      totalPages: Math.ceil(count / limit),
      data,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
