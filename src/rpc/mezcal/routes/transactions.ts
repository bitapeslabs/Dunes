import e, { Router, Request, Response } from "express";
import { Models } from "@/database/createConnection";
import { esplora_getaddresstxs } from "@/lib/apis/esplora";
import { isBoxedError } from "@/lib/boxed";
import { regtestTransactionsIntoBlock } from "@/lib/regtestutils";
import { getNoBigIntObject } from "@/lib/utils";
import { EventDto } from "@/lib/regtestutils";
import { mapToMezcalTransactions } from "@/lib/regtestutils";
import { IEsploraTransaction } from "@/lib/apis/esplora/types";

interface RequestWithDB extends Request {
  db: Models;
}

const router = Router();

const TYPE_LABEL: Record<0 | 1 | 2 | 3, "ETCH" | "MINT" | "TRANSFER" | "BURN"> =
  {
    0: "ETCH",
    1: "MINT",
    2: "TRANSFER",
    3: "BURN",
  };

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

    const transactionMap = esploraResponse.data.reduce(
      (acc: Record<string, IEsploraTransaction>, tx: IEsploraTransaction) => {
        acc[tx.txid] = tx;
        return acc;
      },
      {} as Record<string, IEsploraTransaction>
    );

    let regtestResult = await regtestTransactionsIntoBlock(
      esploraResponse.data
    );

    const events = mapToMezcalTransactions(
      regtestResult.map(getNoBigIntObject<EventDto, EventDto>).map((event) => ({
        ...event,
        owner_address: address,
        type: TYPE_LABEL[event.type as 0 | 1 | 2 | 3],
        tx: transactionMap[event.transaction as string],
      }))
    );
    res.send(events);
  }
);

export default router;
