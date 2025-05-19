/* eslint‑disable @typescript-eslint/explicit-function-return-type */

import { Router, Request, Response } from "express";

import { cacheGetEventsByAddress, IGenericFullMezcal } from "../lib/cache";
import { stripFields } from "@/lib/utils";
import { IJoinedMezcal } from "../lib/queries";

const router = Router();

const TYPE_LABEL: Record<0 | 1 | 2 | 3, "ETCH" | "MINT" | "TRANSFER" | "BURN"> =
  {
    0: "ETCH",
    1: "MINT",
    2: "TRANSFER",
    3: "BURN",
  };

router.get("/address/:address", async (req: Request, res: Response) => {
  const { address } = req.params;

  const page = Math.max(parseInt(String(req.query.page), 10) || 1, 1);
  const limit = Math.min(
    Math.max(parseInt(String(req.query.limit), 10) || 25, 1),
    500
  );
  const offset = (page - 1) * limit;

  try {
    const addressEvents = cacheGetEventsByAddress(address);
    if (!addressEvents) {
      res.send([]);
      return;
    }

    const data = addressEvents
      .map((row) => ({
        ...row,
        type: TYPE_LABEL[row.type as 0 | 1 | 2 | 3],
      }))
      .slice(offset, offset + limit);

    res.json({
      page,
      pageSize: limit,
      total: addressEvents.length,
      totalPages: Math.ceil(addressEvents.length / limit),
      data: data
        .filter((event) => event.mezcal !== null)
        .map((event) => ({
          ...event,
          mezcal: stripFields(
            event.mezcal as IGenericFullMezcal<IJoinedMezcal>,
            ["holders"]
          ),
        })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/*
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
*/

export default router;
