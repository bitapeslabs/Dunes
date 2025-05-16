/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { Router, Request, Response } from "express";
import { stripFields } from "../../../lib/utils";
import cache, { clearAndPopulateRpcCache } from "../lib/cache";

const router = Router();

router.get("/all", async (req: Request, res: Response): Promise<void> => {
  const rawPage = Number(req.query.page ?? 1);
  const rawLimit = Number(req.query.limit ?? 100);

  const page = Math.max(rawPage || 1, 1);
  const limit = Math.min(Math.max(rawLimit || 100, 1), 500);
  const offset = (page - 1) * limit;

  try {
    if (!cache["rpc:etchings:all"]) {
      await clearAndPopulateRpcCache(req.db);
    }

    const etchings = cache["rpc:etchings:all"].etchings.slice(
      offset,
      offset + limit
    );

    res.status(200).json({
      total_etchings: cache["rpc:etchings:all"].total_etchings,
      page,
      limit,
      etchings: etchings.map((mezcal) => stripFields(mezcal, ["holders"])),
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

      // ensure cache is ready
      if (!cache["rpc:etchings:all"]) {
        await clearAndPopulateRpcCache(req.db);
      }

      const etchings = cache["rpc:etchings:all"].etchings;

      const match = etchings.find((e) => {
        return (
          e.mezcal_protocol_id === identifier ||
          e.name.toLowerCase() === identifier.toLowerCase()
        );
      });

      if (!match) {
        res.status(404).json({ error: "Mezcal not found" });
        return;
      }

      res.status(200).json(stripFields(match, ["holders"]));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

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
      // ensure cache is ready
      if (!cache["rpc:etchings:all"]) {
        await clearAndPopulateRpcCache(req.db);
      }

      const etchings = cache["rpc:etchings:all"].etchings;

      // find mezcal by id or name (case-insensitive)
      const match = etchings.find((e) => {
        return (
          e.mezcal_protocol_id === identifier ||
          e.name.toLowerCase() === identifier.toLowerCase()
        );
      });

      if (!match) {
        res.status(404).json({ error: "Mezcal not found" });
        return;
      }

      const allHolders = match.holders ?? [];
      const total_holders = allHolders.length;
      const paginatedHolders = allHolders.slice(offset, offset + limit);

      res.status(200).json({
        total_holders,
        page,
        limit,
        holders: paginatedHolders,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
