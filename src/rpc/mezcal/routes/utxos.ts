import { Router, Request, Response } from "express";
import { Models } from "@/database/createConnection";

import { cacheGetUtxoBalancesByAddress } from "../lib/cache";

interface RequestWithDB extends Request {
  db: Models;
}

const router = Router();

router.get("/:address", async (req: RequestWithDB, res: Response) => {
  try {
    const { address } = req.params;
    const utxoBalances = cacheGetUtxoBalancesByAddress(address);
    if (!utxoBalances) {
      res.send([]);
      return;
    }

    res.json(utxoBalances);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
