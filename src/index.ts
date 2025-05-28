import fs from "node:fs";
import express, {
  Application,
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";
import bodyParser from "body-parser";

import { createRpcClient } from "@/lib/apis/bitcoinrpc";
import { log, sleep } from "@/lib/utils";
import { storage as newStorage, IStorage } from "@/lib/storage";
import {
  CONFIRM_DEPTH,
  GENESIS_BLOCK,
  RPC_ENABLED,
  INDEXER_ENABLED,
  CACHE_REFRESH_INTERVAL,
  ELECTRUM_API_URL,
  BLOCK_CHECK_INTERVAL,
} from "@/lib/consts";
import {
  blockManager as createBlockManager,
  prefetchTransactions,
} from "@/lib/mezcalutils";
import {
  databaseConnection as createConnection,
  Models,
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
  RPC_WSS_ENABLED,
  RPC_WSS_PORT,
  RPC_CERT_PATH,
  RPC_KEY_PATH,
} from "@/lib/consts";
import { WebSocketServer } from "ws";
import https from "node:https";
import cors from "cors";
import { rollbackIndexerStateTo } from "./lib/chainstate";

const rpcClient = createRpcClient({
  url: BTC_RPC_URL,
  username: BTC_RPC_USERNAME,
  password: BTC_RPC_PASSWORD,
});

const { callRpc, callRpcBatch } = rpcClient;

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

let broadcastBlockTip: (height: number) => void = () => {};

const startWs = (): void => {
  const server = https.createServer({
    cert: fs.readFileSync(RPC_CERT_PATH),
    key: fs.readFileSync(RPC_KEY_PATH),
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {});

  broadcastBlockTip = (height: number) => {
    const payload = JSON.stringify({ type: "block_tip", height });
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) client.send(payload);
    });
  };

  server.listen(RPC_WSS_PORT, () => {
    log(`WSS “block_tip” running on :${RPC_WSS_PORT}`, "info");
  });
};

const startRpc = async (): Promise<void> => {
  if (RPC_WSS_ENABLED) startWs();

  log("Connecting to DB  » rpc", "info");
  const db = await createConnection();

  log("Starting RPC server", "info");
  const app: Application = express();
  app.use(cors());

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

  if (ELECTRUM_API_URL) {
    app.use(
      "/mezcal/transactions",
      (await import("@/rpc/mezcal/routes/transactions")).default
    );
  }

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
    log("Run Node with --expose-gc", "error");
    return;
  }

  const db = storage.db;

  /* helpers */
  const readInt = async (k: string, d = 0) =>
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
  const readStr = async (k: string, d = "") =>
    (
      await db.Setting.findOrCreate({
        where: { name: k },
        defaults: { name: k, value: d },
      })
    )[0].value ?? d;
  const writeStr = (k: string, v: string) =>
    db.Setting.update({ value: v }, { where: { name: k } });

  /* initial cursor setup */
  let lastProcessed = await readInt("last_block_processed");
  const prefetched = await readInt("prefetch");

  if (!prefetched) {
    const count = Number(process.env.PREFETCH_BLOCKS ?? "100");
    const heights = Array.from(
      { length: count },
      (_, i) => GENESIS_BLOCK - count + i
    );
    log(`Prefetching ${count} blocks for fast indexing …`, "info");
    await prefetchTransactions(heights, storage, callRpcBatch);
    await storage.commitChanges();
    await clearAndPopulateRpcCache(storage.db);

    await writeInt("prefetch", 1);
    log("Prefetch complete", "info");
  }

  let current = lastProcessed
    ? lastProcessed + 1
    : Number(await callRpc("getblockcount", []));
  const blockStorage = await newStorage();
  log(`Indexer starting at ${current}`, "info");

  /* — re-org detector — */
  class ReorgHit extends Error {}

  async function ensureNoReorg(height: number): Promise<void> {
    const confirmedHeight = await readInt("last_confirmed_height");
    if (confirmedHeight === 0 || height < confirmedHeight + CONFIRM_DEPTH)
      return;

    const ourHash = await readStr("last_confirmed_hash");
    const chainHash = await callRpc("getblockhash", [confirmedHeight]);
    if (ourHash === chainHash) return; // still on same chain

    /* mismatch: roll back ONE block before the confirmed tip */
    const forkPoint = confirmedHeight - 1;
    log(`⚠️  Reorg detected → rolling back to ${forkPoint}`, "panic");

    await rollbackIndexerStateTo(forkPoint, db);
    await writeInt("last_block_processed", forkPoint - 1);
    await writeInt("last_confirmed_height", forkPoint - 1);
    await writeStr(
      "last_confirmed_hash",
      await callRpc("getblockhash", [forkPoint - 1])
    );

    if (RPC_ENABLED) await clearAndPopulateRpcCache(db);

    current = forkPoint; // rewind main loop cursor
    throw new ReorgHit(); // abort current chunk
  }

  /* — main sync loop — */
  while (true) {
    const tip = Number(await callRpc("getblockcount", []));
    if (current <= tip) {
      log(`Processing ${current}…${tip}`, "info");
      let reorg = false;
      try {
        await processRange(current, tip);
      } catch (e) {
        if (!(e instanceof ReorgHit)) throw e;
        reorg = true; // we rolled back
      }
      if (!reorg) current = tip + 1;
    }
    await sleep(Number(BLOCK_CHECK_INTERVAL ?? "15000"));
  }
  async function processRange(start: number, end: number): Promise<void> {
    const { getBlock } = await createBlockManager(
      callRpcBatch,
      end,
      blockStorage
    );
    const chunk = Number(process.env.MAX_STORAGE_BLOCK_CACHE_SIZE ?? "10");
    const safeStep = Math.min(chunk, CONFIRM_DEPTH);

    for (let height = start; height <= end; height += safeStep) {
      //await ensureNoReorg(height); // <── re-org check

      const lastProc = Math.min(height + chunk - 1, end);
      const list = Array.from(
        { length: lastProc - height + 1 },
        (_, i) => height + i
      );

      log("Fetching blocks: " + list.join(", "), "info");
      const blocks = await Promise.all(list.map(getBlock));
      log(`Fetched ${blocks.length} blocks from ${list[0]} to ${list.at(-1)}`);
      await Promise.all(blocks.map((b) => loadBlockIntoMemory(b, storage)));
      blocks.forEach((b, i) =>
        processBlock(
          { blockHeight: list[i], blockData: b },
          rpcClient,
          storage,
          false
        )
      );

      broadcastBlockTip(list.at(-1)!);

      await emitEvents(storage);
      await storage.commitChanges();
      if (RPC_ENABLED) await clearAndPopulateRpcCache(storage.db);

      await writeInt("last_block_processed", lastProc);

      /* update confirmed checkpoint */
      const confirmTarget = lastProc - CONFIRM_DEPTH + 1;
      if (confirmTarget >= GENESIS_BLOCK) {
        const hash: string = await callRpc("getblockhash", [confirmTarget]);
        await writeInt("last_confirmed_height", confirmTarget);
        await writeStr("last_confirmed_hash", hash);
      }

      log(`Processed ${height}…${lastProc}`, "info");
    }
  }
};
const start = async (): Promise<void> => {
  const freshDb = process.argv.includes("--new");

  const storage = await newStorage(freshDb);

  if (process.argv.includes("--rollback-to")) {
    let rollbackBlock = Number(
      process.argv[process.argv.indexOf("--rollback-to") + 1]
    );

    await rollbackIndexerStateTo(rollbackBlock, storage.db);
    log(`Rolled back to block ${rollbackBlock}`, "info");
  }

  if (INDEXER_ENABLED) startServer(storage);
  if (RPC_ENABLED) startRpc();
};

start();
