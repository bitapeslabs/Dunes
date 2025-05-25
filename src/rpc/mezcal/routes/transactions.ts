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
import { ELECTRUM_API_URL } from "@/lib/consts";

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

  if (!ELECTRUM_API_URL) {
    res.status(500).send({ error: "Electrum API URL is not configured" });
    return;
  }

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

router.get("/rawlogs/:txid", async (req: RequestWithDB, res: Response) => {
  const { txid } = req.params;
  const { Transaction } = req.db;

  if (!ELECTRUM_API_URL) {
    res.status(500).send({ error: "Electrum API URL is not configured" });
    return;
  }

  const tx = await Transaction.findOne({
    where: { hash: txid },
  });

  if (!tx) {
    res.status(404).send({ error: "Transaction not found" });
    return;
  }

  if (!tx.logs) {
    res.status(404).send({ error: "No logs found for this transaction" });
    return;
  }

  try {
    res.send(tx.logs);
  } catch (error) {
    res.status(500).send({ error: "Failed to parse transaction logs" });
  }
});

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>\"']/g,
    (c) =>
      ((
        {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        } as any
      )[c])
  );
}

function ellipsis(json: string, max = 100): string {
  const esc = escapeHtml(json);
  return esc.length > max ? esc.slice(0, max) + " …" : esc;
}

/* Very small server-side JSON highlighter */
function syntaxHighlight(json: string): string {
  return escapeHtml(json).replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = "number";
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? "key" : "string";
      } else if (/true|false/.test(match)) {
        cls = "bool";
      } else if (/null/.test(match)) {
        cls = "null";
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}
router.get("/nicelogs/:txid", async (req: RequestWithDB, res: Response) => {
  const { txid } = req.params;
  const { Transaction } = req.db;

  // sanity check
  if (!ELECTRUM_API_URL) {
    res.status(500).send({ error: "Electrum API URL is not configured" });
    return;
  }

  const tx = await Transaction.findOne({ where: { hash: txid } });

  if (!tx) {
    res.status(404).send({ error: "Transaction not found" });
    return;
  }

  if (!tx.logs) {
    res.status(404).send({ error: "No logs found for this transaction" });
    return;
  }
  const wantHtml =
    req.query.html === "1" || req.get("accept")?.includes("text/html");

  if (!wantHtml) {
    res.type("text/plain").send(tx.logs);
    return;
  }

  /* ---------- render HTML ---------- */
  const linesHtml = tx.logs
    .trimEnd()
    .split("\n")
    .map((raw, idx) => {
      const lnSpan = `<span class="ln">${idx + 1}</span>`;

      /* ── try to find JSON substring ─────────────────────────────── */
      const firstBrace = raw.indexOf("{");
      const firstBrack = raw.indexOf("[");
      const startIdx =
        firstBrace === -1
          ? firstBrack
          : firstBrack === -1
          ? firstBrace
          : Math.min(firstBrace, firstBrack);

      let bodyHtml: string;

      if (startIdx !== -1) {
        const prefix = raw.slice(0, startIdx);
        const candidate = raw.slice(startIdx).trim();

        try {
          const obj = JSON.parse(candidate);
          const json = JSON.stringify(obj, null, 2);
          bodyHtml =
            `${escapeHtml(prefix)}<details><summary>${ellipsis(
              candidate
            )}</summary>` +
            `<pre class="json">${syntaxHighlight(json)}</pre></details>`;
        } catch {
          // not valid JSON → output raw
          bodyHtml = escapeHtml(raw);
        }
      } else {
        bodyHtml = escapeHtml(raw);
      }

      return `<div class="line">${lnSpan}${bodyHtml}</div>`;
    })
    .join("");

  res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8" />
<title>Logs for ${txid}</title>
<style>
  body{background:#141414;color:#e8e8e8;font:14px/1.4 monospace;margin:0}
  .wrapper{padding:24px}
  .line{white-space:pre-wrap}
  .ln{display:inline-block;width:48px;color:#666;user-select:none}
  .line:nth-child(odd){background:#1c1c1c}
  .line:hover{background:#333}
  details{margin-left:8px}
  summary{cursor:pointer;color:#6cf}

  /* JSON syntax colouring */
  .json{white-space:pre-wrap}
  .json .key    { color:#ce9178 }
  .json .string { color:#ce9178 }
  .json .number { color:#b5cea8 }
  .json .bool,
  .json .null   { color:#569cd6 }
</style></head><body>
<div class="wrapper">${linesHtml}</div></body></html>`);
});

export default router;
