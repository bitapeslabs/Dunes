/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { Router, Request, Response } from "express";
import { Op } from "sequelize";

import { simplify } from "../../../lib/utils";
import { resolveMezcal } from "../lib/resolvers";
import {
  Models,
  IMezcal,
  IBalance,
  IAddress,
} from "@/database/createConnection";

import { IJoinedBalanceInstance, IJoinedMezcalInstance } from "../lib/queries"; // <- the joined types file you showed

const router = Router();

router.get("/all", async (req: Request, res: Response): Promise<void> => {
  const rawPage = Number(req.query.page ?? 1);
  const rawLimit = Number(req.query.limit ?? 100);

  const page = Math.max(rawPage || 1, 1);
  const limit = Math.min(Math.max(rawLimit || 100, 1), 500);
  const offset = (page - 1) * limit;

  try {
    const { Mezcal, Transaction, Address } = req.db;

    /* ── 1. total count ────────────────────────────────────────────────── */
    const total_etchings = await Mezcal.count();

    /* ── 2. fetch one page of etchings ─────────────────────────────────── */
    const etchings = (await Mezcal.findAll({
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
      order: [["id", "DESC"]],
      limit,
      offset,
      attributes: {
        exclude: ["etch_transaction_id", "deployer_address_id"],
      },
    })) as IJoinedMezcalInstance[];

    /* ── 3. response ──────────────────────────────────────────────────── */
    res.status(200).json({
      total_etchings,
      page,
      limit,
      etchings: etchings.map((e) => simplify(e.toJSON())),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get(
  "/info/:identifier",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { identifier } = req.params;

      const db = req.db;
      const { Mezcal, Transaction, Address } = db;

      /* ── 1. resolve identifier → mezcal row (id + proto_id + name) ───────── */
      const mezcalRow = await resolveMezcal(Mezcal, identifier); // returns IMezcal | null
      if (!mezcalRow) {
        res.status(404).json({ error: "Mezcal not found" });
        return;
      }

      /* ── 2. load full mezcal with joins (etch tx + deployer address) ─────── */
      const mezcal = (await Mezcal.findOne({
        where: { id: mezcalRow.id },
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
      })) as IJoinedMezcalInstance | null;

      if (!mezcal) {
        res.status(404).json({ error: "Mezcal not found" });
        return;
      }

      res.status(200).json(simplify(mezcal.toJSON()));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/* ========================================================================== */
/*  GET  /holders/:identifier                                                 */
/* ========================================================================== */

router.get(
  "/holders/:identifier",
  async (req: Request, res: Response): Promise<void> => {
    const { identifier } = req.params;

    const rawPage = Number(req.query.page ?? 1);
    const rawLimit = Number(req.query.limit ?? 100);

    const page = Math.max(rawPage || 1, 1);
    const limit = Math.min(Math.max(rawLimit || 100, 1), 500);
    const offset = (page - 1) * limit;

    try {
      const db = req.db;
      const { Mezcal, Balance, Address } = db;

      /* ── 1. resolve mezcal id ────────────────────────────────────────────── */
      const mezcalRow = await resolveMezcal(Mezcal, identifier);
      if (!mezcalRow) {
        res.status(404).json({ error: "Mezcal not found" });
        return;
      }

      /* ── 2. count holders (>0 balance) ─────────────────────────────────── */
      const total_holders = await Balance.count({
        where: { mezcal_id: mezcalRow.id, balance: { [Op.gt]: 0 } },
      });

      /* ── 3. fetch one page of holders ──────────────────────────────────── */
      const rows = (await Balance.findAll({
        where: { mezcal_id: mezcalRow.id, balance: { [Op.gt]: 0 } },
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
      })) as IJoinedBalanceInstance[];

      /* ── 4. build response ─────────────────────────────────────────────── */
      const holders = rows.map((b) => ({
        address: b.address.address,
        balance: b.balance,
      }));

      res.status(200).json({ total_holders, page, limit, holders });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/* ------------------------------------------------------------------ export */

export default router;
