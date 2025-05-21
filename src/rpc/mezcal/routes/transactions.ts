import e, { Router, Request, Response } from "express";
import { Models } from "@/database/createConnection";
import { esplora_getaddresstxs } from "@/lib/apis/esplora";
import { isBoxedError } from "@/lib/boxed";
import { regtestTransactionsIntoBlock } from "@/lib/regtestutils";
import { getNoBigIntObject } from "@/lib/utils";
import { EventDto } from "@/lib/regtestutils";
import {
  mapToMezcalTransactions,
  IMezcalTransaction,
} from "@/lib/regtestutils";
import { IEsploraTransaction } from "@/lib/apis/esplora/types";
import { cacheGetEventsByTxid, IJoinedEvent } from "../lib/cache";

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

const getBtcEventsFromEsploraTransactions = (
  owner_address: string,
  transactions: IEsploraTransaction[]
): IMezcalTransaction[] => {
  return transactions
    .map((tx) => {
      let target: "incoming" | "outgoing" = "incoming";
      if (owner_address == tx.vin[0].prevout.scriptpubkey_address) {
        target = "outgoing";
      }

      return tx.vout
        .filter(
          (out) =>
            out.scriptpubkey_address !==
              tx.vin[0].prevout.scriptpubkey_address && out.value > 0
        )
        .map(
          (out) =>
            ({
              type: "TRANSFER",
              target,
              target_address:
                target === "incoming"
                  ? tx.vin[0].prevout.scriptpubkey_address
                  : out.scriptpubkey_address,
              confirmed: tx.status.confirmed,
              asset: {
                id: "btc",
                name: "BTC",
                symbol: "BTC",
                decimals: 8,
              },
              amount: String(out.value),
              transaction_id: tx.txid,
              timestamp: Number(tx.status.block_time ?? tx.locktime),
            } as IMezcalTransaction)
        )
        .filter((event) => BigInt(event.amount) > 1000n);
    })
    .flat(2);
};

router.get("/address/:address", async (req: RequestWithDB, res: Response) => {
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

  // create mezcal events

  const btcMezcalEvents = getBtcEventsFromEsploraTransactions(
    address,
    esploraResponse.data
  );

  const confirmedMezcalEvents = mapToMezcalTransactions(
    esploraResponse.data
      .filter((tx) => tx.status.confirmed)
      .map((tx) => tx.txid)
      .map((txid) => cacheGetEventsByTxid(txid) as IJoinedEvent[])
      .flat(2)
      .filter(Boolean)
      .map((event) => ({
        ...event,
        owner_address: address,
        type: TYPE_LABEL[event.type as 0 | 1 | 2 | 3],
        tx: transactionMap[event.transaction as string],
      }))
  );

  let regtestResult = await regtestTransactionsIntoBlock(
    esploraResponse.data.filter((tx) => tx.status.confirmed === false)
  );

  console.log("regtestResult", regtestResult);

  const unconfirmedEvents = mapToMezcalTransactions(
    regtestResult
      .map(getNoBigIntObject<EventDto, EventDto>)
      .map((event) => ({
        ...event,
        owner_address: address,
        type: TYPE_LABEL[event.type as 0 | 1 | 2 | 3],
        tx: transactionMap[event.transaction as string],
      }))
      .filter(
        (event) =>
          event.to_address === address || event.from_address === address
      )
  );

  let events = [
    ...confirmedMezcalEvents,
    ...unconfirmedEvents,
    ...btcMezcalEvents,
  ].sort((a, b) => {
    if (a.confirmed !== b.confirmed) {
      return a.confirmed ? 1 : -1; // unconfirmed (false) comes first
    }
    return b.timestamp - a.timestamp; // latest to oldest
  });
  res.send(events);
});

export default router;
