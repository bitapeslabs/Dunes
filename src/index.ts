import fs from "node:fs";
import path from "node:path";
import express, {
  Application,
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";
import bodyParser from "body-parser";
import axios from "axios";

import { createRpcClient } from "@/lib/bitcoinrpc";
import { log, sleep } from "@/lib/utils";
import { storage as newStorage, IStorage } from "@/lib/storage";
import {
  GENESIS_BLOCK,
  RPC_ENABLED,
  INDEXER_ENABLED,
  CACHE_REFRESH_INTERVAL,
} from "@/lib/consts";
import {
  blockManager as createBlockManager,
  prefetchTransactions,
} from "@/lib/mezcalutils";
import {
  databaseConnection as createConnection,
  Models,
  ISetting,
  IEvent,
  IAddress,
  IMezcal,
  ITransaction,
} from "@/database/createConnection";
import { processBlock, loadBlockIntoMemory } from "@/lib/indexer";
import { clearAndPopulateRpcCache } from "@/rpc/mezcal/lib/cache";
import {
  BTC_RPC_URL,
  BTC_RPC_USERNAME,
  BTC_RPC_PASSWORD,
  RPC_PORT,
} from "@/lib/consts";
import { WebSocketServer } from "ws";
import { RPC_WSS_PORT } from "@/lib/consts";

const rpcClient = createRpcClient({
  url: BTC_RPC_URL,
  username: BTC_RPC_USERNAME,
  password: BTC_RPC_PASSWORD,
});

const { callRpc, callRpcBatch } = rpcClient;

/* ──────────────────────────────────────────────────────────
   extra local types
   ──────────────────────────────────────────────────────── */
interface RequestWithDB extends Request {
  db: Models;
  callRpc: typeof callRpc;
}

interface EventWithJoins {
  id: number;
  type: number;
  block: number;
  amount: string | bigint;
  transaction: ITransaction | null;
  mezcal: IMezcal | null;
  from: IAddress | null;
  to: IAddress | null;
}

const emitEvents = async (storageInstance: IStorage): Promise<void> => {
  const { local, findOne } = storageInstance;

  const joined = Object.values(local.Event).map((event) => {
    const foundTransaction = findOne<ITransaction>(
      "Transaction",
      `${event.transaction_id}@REF@id`,
      undefined,
      true
    );

    const foundMezcal = findOne<IMezcal>(
      "Mezcal",
      `${event.mezcal_id}@REF@id`,
      undefined,
      true
    );

    const foundAddressFrom = findOne<IAddress>(
      "Address",
      `${event.from_address_id}@REF@id`,
      undefined,
      true
    );
    const foundAddressTo = findOne<IAddress>(
      "Address",
      `${event.to_address_id}@REF@id`,
      undefined,
      true
    );

    if (
      !foundTransaction ||
      !foundMezcal ||
      !foundAddressFrom ||
      !foundAddressTo
    ) {
      return null;
    }

    return {
      id: event.id,
      type: event.type,
      block: event.block,
      amount: event.amount,
      transaction: foundTransaction,
      mezcal: foundMezcal,
      from: foundAddressFrom,
      to: foundAddressTo,
    };
  });
};
/* ──────────────────────────────────────────────────────────
   RPC server (express)
   ──────────────────────────────────────────────────────── */

/* ───────────────────────  SHARED WS BROADCAST HANDLE  ──────────────────────── */
let broadcastBlockTip: (height: number) => void = () => {}; // no-op until WS up

/* ──────────────────────────  WEBSOCKET BOOTSTRAP  ──────────────────────────── */
const startWs = (): void => {
  const wss = new WebSocketServer({ port: Number(RPC_WSS_PORT) });

  wss.on("connection", (ws) => {
    // Optional: immediately send current tip if you track it
  });

  broadcastBlockTip = (height: number) => {
    const payload = JSON.stringify({ type: "block_tip", height });
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) client.send(payload);
    });
  };

  log(`WSS “block_tip” running on :${RPC_WSS_PORT}`, "info");
};

const startRpc = async (): Promise<void> => {
  //Consitently keep a cache and update on every block using the block manager below
  if (RPC_ENABLED) startWs(); // 👈 add this line

  log("Connecting to DB  » rpc", "info");
  const db = await createConnection();

  log("Starting RPC server", "info");
  const app: Application = express();
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());

  /* injector & auth */
  const injector: RequestHandler = (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    if (
      process.env.RPC_AUTH &&
      req.headers.authorization !== process.env.RPC_AUTH
    ) {
      res.status(401).send("Unauthorized");
      return;
    }
    req.db = db;
    req.callRpc = callRpc;
    next();
  };

  log("Hydrating cache from postgresql..", "info");
  await clearAndPopulateRpcCache(db);
  log("done!", "info");

  app.use(injector);

  /* mount routes — default exports */
  app.use(
    "/mezcal/events",
    (await import("@/rpc/mezcal/routes/events")).default
  );
  app.use(
    "/mezcal/balances",
    (await import("@/rpc/mezcal/routes/balances")).default
  );
  app.use("/mezcal/rpc", (await import("@/rpc/mezcal/routes/rpc")).default);
  app.use("/mezcal/utxos", (await import("@/rpc/mezcal/routes/utxos")).default);
  app.use(
    "/mezcal/etchings",
    (await import("@/rpc/mezcal/routes/etchings")).default
  );

  app.listen(Number(RPC_PORT ?? 3030), () =>
    log(`RPC server running on :${RPC_PORT}`, "info")
  );

  setInterval(async () => {
    await clearAndPopulateRpcCache(db);
    log("Cache refreshed", "info");
  }, CACHE_REFRESH_INTERVAL);
};

/* ──────────────────────────────────────────────────────────
   indexer  (block‑sync loop)
   ──────────────────────────────────────────────────────── */
const startServer = async (storage: IStorage): Promise<void> => {
  if (!global.gc) {
    log("Run Node with  --expose-gc  to enable manual GC", "error");
    return;
  }

  const db = storage.db;
  const Setting = db.Setting as unknown as ISetting;

  /* helpers to read / write numeric settings */
  const readInt = async (k: string, d = 0): Promise<number> =>
    Number(
      (
        await db.Setting.findOrCreate({
          where: { name: k },
          defaults: { name: k, value: String(d) },
        })
      )[0].value ?? d
    );

  const writeInt = (k: string, v: number) =>
    db.Setting.update({ value: String(v) }, { where: { name: k } });

  let lastProcessed = await readInt("last_block_processed");
  const prefetched = await readInt("prefetch");

  // PREFECTH SETTINGS
  // ==========================

  if (!prefetched) {
    const count = Number(process.env.PREFETCH_BLOCKS ?? "100");
    const heights = Array.from(
      { length: count },
      (_, i) => GENESIS_BLOCK - count + i
    );
    log(`Prefetching ${count} blocks for fast indexing …`, "info");
    await prefetchTransactions(heights, storage, callRpcBatch);
    await storage.commitChanges();

    // Clear the cache and repopulate it because we processed a new block that has new data rpc should know about
    await writeInt("prefetch", 1);
    log("Prefetch complete", "info");
  }

  // ========================

  let current = lastProcessed ? lastProcessed + 1 : GENESIS_BLOCK;

  const blockStorage = await newStorage();

  log(`Indexer starting at height ${current}`, "info");

  /* infinite sync loop */
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const tip = Number(await callRpc("getblockcount", []));
    if (current <= tip) {
      log("Processing blocks " + current + " - " + tip, "info");

      await processRange(current, tip);
      current = tip + 1;
      log("Polling for new blocks... Last Processed: " + current, "info");
    }
    await sleep(Number(process.env.BLOCK_CHECK_INTERVAL ?? "15000"));
  }

  async function processRange(start: number, end: number): Promise<void> {
    const { getBlock } = await createBlockManager(
      callRpcBatch,
      end,
      blockStorage
    );

    const chunk = Number(process.env.MAX_STORAGE_BLOCK_CACHE_SIZE ?? "10");
    for (let height = start; height <= end; height += chunk) {
      const lastProcessed = Math.min(height + chunk - 1, end);
      const list = Array.from(
        { length: lastProcessed - height + 1 },
        (_, i) => height + i
      );

      log("Fetching blocks: " + list.join(", "), "info");

      const blocks = await Promise.all(list.map((v) => getBlock(v)));

      await Promise.all(
        blocks.map((block) => loadBlockIntoMemory(block, storage))
      );
      blocks.forEach((b, i) =>
        processBlock(
          { blockHeight: list[i], blockData: b },
          rpcClient,
          storage,
          false
        )
      );

      broadcastBlockTip(list[list.length - 1]);

      //Repopulate the cache with the new data because blocks may contain new Mezcalstone data rpc should know about
      if (RPC_ENABLED) {
        await clearAndPopulateRpcCache(storage.db);
      }
      await emitEvents(storage);
      await storage.commitChanges();

      //

      await writeInt("last_block_processed", lastProcessed);
      log(`Processed ${height}…${lastProcessed}`, "info");
    }
  }
};

const start = async (): Promise<void> => {
  const freshDb = process.argv.includes("--new");

  const storage = await newStorage(freshDb);

  if (INDEXER_ENABLED) startServer(storage);
  if (RPC_ENABLED) startRpc();
};

start();
