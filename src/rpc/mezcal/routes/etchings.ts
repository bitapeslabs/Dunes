/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { Router, Request, Response } from "express";
import { stripFields } from "../../../lib/utils";
import {
  cacheGetAllEtchings,
  cacheGetSingleEtchingByIdentifier,
} from "../lib/cache";

const router = Router();

router.get("/all", async (req: Request, res: Response): Promise<void> => {
  const rawPage = Number(req.query.page ?? 1);
  const rawLimit = Number(req.query.limit ?? 100);

  const page = Math.max(rawPage || 1, 1);
  const limit = Math.min(Math.max(rawLimit || 100, 1), 500);
  const offset = (page - 1) * limit;

  const statusRaw =
    (req.query.status as string | undefined)?.toLowerCase() ?? "all";
  const status: "in-progress" | "completed" | "all" =
    statusRaw === "in-progress" || statusRaw === "completed"
      ? statusRaw
      : "all";

  const qRaw = (req.query.q as string | undefined)?.trim() ?? "";
  const q = qRaw.toLowerCase();

  try {
    const allEtchings = cacheGetAllEtchings();
    if (!allEtchings) {
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    let filtered = allEtchings.etchings;

    if (status !== "all") {
      filtered = filtered.filter((mezcal) => {
        const mints = BigInt(mezcal.mints);
        const mintCap =
          mezcal.mint_cap !== null ? BigInt(mezcal.mint_cap) : null;

        if (status === "in-progress") {
          return (
            mezcal.unmintable === 0 && (mintCap === null || mints < mintCap)
          );
        }
        return mintCap !== null && mints === mintCap;
      });
    }

    if (q !== "") {
      filtered = filtered.filter((mezcal) =>
        mezcal.name.toLowerCase().includes(q)
      );
    }

    const etchings = filtered.slice(offset, offset + limit);

    res.status(200).json({
      total_etchings: filtered.length,
      page,
      limit,
      status,
      q,
      etchings: etchings.map((m) => stripFields(m, ["holders"])),
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

      let foundEtching = cacheGetSingleEtchingByIdentifier(identifier);

      if (!foundEtching) {
        res.status(404).json({ error: "Mezcal not found" });
        return;
      }

      res.status(200).json(stripFields(foundEtching, ["holders"]));
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
      const { identifier } = req.params;

      let foundEtching = cacheGetSingleEtchingByIdentifier(identifier);

      if (!foundEtching) {
        res.status(404).json({ error: "Mezcal not found" });
        return;
      }

      const allHolders = foundEtching.holders ?? [];
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
