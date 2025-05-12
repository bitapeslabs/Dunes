/* eslint-disable no-console */

/* ────────────────────────────────────────────────────────────────────────────
   env + external deps
   ────────────────────────────────────────────────────────────────────────── */
import "dotenv/config";
import express, { Request, Response, NextFunction, Application } from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "node:fs";
import path from "node:path";

/* ────────────────────────────────────────────────────────────────────────────
   internal aliases
   ────────────────────────────────────────────────────────────────────────── */

import { createRpcClient } from "@/lib//bitcoinrpc";
import { storage } from "@/lib/storage";
import { log, sleep } from "@/lib/utils";
import { blockManager, prefetchTransactions } from "@/lib/duneutils";
import { processBlock, loadBlockIntoMemory } from "@/lib/indexer";
import { GENESIS_BLOCK, RPC_PORT, PREFETCH_BLOCKS } from "@/lib/consts";

import {
  Models,
  IEvent,
  IAddress,
  IDune,
  ITransaction,
  ISetting,
} from "@/database/createConnection";
import { databaseConnection as createConnection } from "@/database/createConnection";

/* ────────────────────────────────────────────────────────────────────────────
   typed helpers
   ────────────────────────────────────────────────────────────────────────── */

type RpcClient = ReturnType<typeof createRpcClient>;

interface EventWithJoins {
  id: number;
  type: number;
  block: number;
  amount: string | bigint;
  transaction: ITransaction | null;
  dune: IDune | null;
  from: IAddress | null;
  to: IAddress | null;
}

interface RequestWithDB extends Request {
  db: Models;
  callRpc: RpcClient["callRpc"];
}

/* ────────────────────────────────────────────────────────────────────────────
   constants & test‑block (reg‑test only)
   ────────────────────────────────────────────────────────────────────────── */

const TEST_BLOCK: unknown = JSON.parse(
  fs.readFileSync(path.join(__dirname, "./dumps/testblock.json"), "utf8")
);

/* ────────────────────────────────────────────────────────────────────────────
   Discord helper (optional)
   ────────────────────────────────────────────────────────────────────────── */

const emitToDiscord = async (events: EventWithJoins[]): Promise<void> => {
  if (!process.env.DISCORD_WEBHOOK) return;

  const etchings = events.filter((e) => e.type === 0).slice(0, 5);

  for (const ev of etchings) {
    try {
      const embed = {
        title: "New etching!",
        description: `The dune **${
          ev.dune?.name ?? "unknown"
        }** has been etched!`,
        color: 0xffa500,
        fields: Object.entries(ev.dune ?? {})
          .slice(0, 10)
          .map(([k, v]) => ({ name: k, value: String(v), inline: true })),
        timestamp: new Date().toISOString(),
      };

      await axios.post(process.env.DISCORD_WEBHOOK, { embeds: [embed] });
      await sleep(200);
    } catch {
      /* swallow network errors */
    }
  }
};

/* ────────────────────────────────────────────────────────────────────────────
   event emitter  (called after each committed block‑chunk)
   ────────────────────────────────────────────────────────────────────────── */

const emitEvents = async (
  st: Awaited<ReturnType<typeof storage>>
): Promise<void> => {
  const { local, findOne } = st;

  const joined: EventWithJoins[] = Object.values(local.Event).map((ev) => ({
    id: ev.id,
    type: ev.type,
    block: ev.block,
    amount: ev.amount,
    transaction: findOne(
      "Transaction",
      `${ev.transaction_id}@REF@id`,
      undefined,
      true
    ),
    dune: findOne("Dune", `${ev.dune_id}@REF@id`, undefined, true),
    from: findOne("Address", `${ev.from_address_id}@REF@id`, undefined, true),
    to: findOne("Address", `${ev.to_address_id}@REF@id`, undefined, true),
  }));

  await emitToDiscord(joined);
};

/* ────────────────────────────────────────────────────────────────────────────
   RPC (express) server
   ────────────────────────────────────────────────────────────────────────── */

const startRpcServer = async (): Promise<void> => {
  log("Connecting to DB (RPC)…", "info");
  const db = await createConnection();

  const app: Application = express();
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());

  /* auth + injectors */
  app.use((req: RequestWithDB, res: Response, next: NextFunction) => {
    if (
      process.env.RPC_AUTH &&
      req.headers.authorization !== process.env.RPC_AUTH
    ) {
      res.status(401).send("Unauthorized");
      return;
    }
    req.db = db;
    req.callRpc = rpc.callRpc;
    next();
  });

  /* mount routes (they are already typed) */
  app.use(
    "/dunes/events",
    await import("@/rpc/dunes/routes/events").then((m) => m.default)
  );
  app.use(
    "/dunes/balances",
    await import("@/rpc/dunes/routes/balances").then((m) => m.default)
  );
  app.use(
    "/dunes/rpc",
    await import("@/rpc/dunes/routes/rpc").then((m) => m.default)
  );
  app.use(
    "/dunes/utxos",
    await import("@/rpc/dunes/routes/utxos").then((m) => m.default)
  );
  app.use(
    "/dunes/etchings",
    await import("@/rpc/dunes/routes/etchings").then((m) => m.default)
  );

  app.listen(RPC_PORT, () =>
    log(`RPC server listening on :${RPC_PORT}`, "info")
  );
};

/* ────────────────────────────────────────────────────────────────────────────
   indexer (main loop)
   ────────────────────────────────────────────────────────────────────────── */

const rpc = createRpcClient({
  url: process.env.BTC_RPC_URL!,
  username: process.env.BTC_RPC_USERNAME!,
  password: process.env.BTC_RPC_PASSWORD!,
});

const startIndexer = async (): Promise<void> => {
  if (!global.gc) {
    log("Run node with --expose-gc to enable manual GC", "error");
    return;
  }

  const useTest = process.argv.includes("--test");
  const st = await storage(process.argv.includes("--new"));
  const { db } = st;
  const Setting = db.Setting as unknown as ISetting;

  /* last processed height */
  const lastRow = await Setting.findOrCreate({
    where: { name: "last_block_processed" },
    defaults: { value: "0" },
  });
  let lastBlockProcessed = parseInt(String(lastRow[0].value), 10);

  /* optional pre‑fetch of early blocks */
  const prefetchRow = await Setting.findOrCreate({
    where: { name: "prefetch" },
    defaults: { value: "0" },
  });
  if (Number(prefetchRow[0].value) === 0) {
    const howMany = PREFETCH_BLOCKS;
    log(`Prefetching ${howMany} blocks before genesis…`, "info");

    const heights = Array.from(
      { length: howMany },
      (_, i) => GENESIS_BLOCK - howMany + i
    );
    await prefetchTransactions(heights, st, rpc.callRpcBatch);
    await st.commitChanges();
    await Setting.update({ value: "1" }, { where: { name: "prefetch" } });
    log("Prefetch done!", "info");
  }

  /* block reader */
  const bm = await blockManager(rpc.callRpcBatch);

  let current = lastBlockProcessed ? lastBlockProcessed + 1 : GENESIS_BLOCK;

  log(`Starting indexer at height ${current}`, "info");

  while (true) {
    const tip = Number(await rpc.callRpc("getblockcount", []));
    if (current <= tip) {
      log(`Processing blocks ${current}…${tip}`, "info");
      await processRange(current, tip);
      current = tip + 1;
    }
    await sleep(Number(process.env.BLOCK_CHECK_INTERVAL ?? "15000"));
  }

  /* local helper – process [start,end] inclusive in chunks */
  async function processRange(start: number, end: number): Promise<void> {
    const chunk = Number(process.env.MAX_STORAGE_BLOCK_CACHE_SIZE ?? "10");

    for (let h = start; h <= end; h += chunk) {
      const upto = Math.min(h + chunk - 1, end);
      const list = Array.from({ length: upto - h + 1 }, (_, i) => h + i);
      const blobs = useTest
        ? [TEST_BLOCK as any]
        : await Promise.all(list.map(bm.getBlock));

      /* stage all blocks into memory first */
      await Promise.all(blobs.map((b) => loadBlockIntoMemory(b, st)));

      /* sequentially process after staged (keeps order) */
      for (let i = 0; i < blobs.length; i++) {
        processBlock(
          { blockHeight: list[i], blockData: blobs[i] },
          rpc.callRpc,
          st,
          useTest
        );
      }

      await emitEvents(st);
      await st.commitChanges();

      await Setting.update(
        { value: String(upto) },
        { where: { name: "last_block_processed" } }
      );
    }
  }
};

/* ────────────────────────────────────────────────────────────────────────────
   bootstrap
   ────────────────────────────────────────────────────────────────────────── */

(async () => {
  if (process.argv.includes("--rpc")) await startRpcServer();
  if (process.argv.includes("--server")) await startIndexer();
})();
