/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { Router, Request, Response } from "express";
import { Op } from "sequelize";

import { simplify } from "../../../lib/utils";
import { resolveDune } from "../lib/resolvers";
import { Models, IDune, IBalance, IAddress } from "@/database/createConnection";

import { IJoinedBalanceInstance, IJoinedDuneInstance } from "../lib/queries"; // <- the joined types file you showed

const router = Router();

router.get(
  "/info/:identifier",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { identifier } = req.params;

      const db = req.db;
      const { Dune, Transaction, Address } = db;

      /* ── 1. resolve identifier → dune row (id + proto_id + name) ───────── */
      const duneRow = await resolveDune(Dune, identifier); // returns IDune | null
      if (!duneRow) {
        res.status(404).json({ error: "Dune not found" });
        return;
      }

      /* ── 2. load full dune with joins (etch tx + deployer address) ─────── */
      const dune = (await Dune.findOne({
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
      })) as IJoinedDuneInstance | null;

      if (!dune) {
        res.status(404).json({ error: "Dune not found" });
        return;
      }

      res.status(200).json(simplify(dune.toJSON()));
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
      const { Dune, Balance, Address } = db;

      /* ── 1. resolve dune id ────────────────────────────────────────────── */
      const duneRow = await resolveDune(Dune, identifier);
      if (!duneRow) {
        res.status(404).json({ error: "Dune not found" });
        return;
      }

      /* ── 2. count holders (>0 balance) ─────────────────────────────────── */
      const total_holders = await Balance.count({
        where: { dune_id: duneRow.id, balance: { [Op.gt]: 0 } },
      });

      /* ── 3. fetch one page of holders ──────────────────────────────────── */
      const rows = (await Balance.findAll({
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
