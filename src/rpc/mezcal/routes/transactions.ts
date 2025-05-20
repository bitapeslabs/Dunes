import { Router, Request, Response } from "express";
import { Models } from "@/database/createConnection";
import { esplora_getaddresstxs } from "@/lib/apis/esplora";
import { isBoxedError } from "@/lib/boxed";
import { regtestBlock } from "@/lib/mezcalutils";
import { getNoBigIntObject } from "@/lib/utils";

interface RequestWithDB extends Request {
  db: Models;
}

const router = Router();

router.get(
  "/address/regtest/:address",
  async (req: RequestWithDB, res: Response) => {
    const { address } = req.params;

    const esploraResponse = await esplora_getaddresstxs(
      address,
      req.query.last_seen_txid as string
    );
    if (isBoxedError(esploraResponse)) {
      res.status(500).send({ error: "Failed to fetch transactions" });
      return;
    }

    const state = await regtestBlock(esploraResponse.data);
    res.send(getNoBigIntObject(state));
  }
);

export default router;
