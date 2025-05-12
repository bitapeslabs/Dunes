import "dotenv/config";

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
import { GENESIS_BLOCK } from "@/lib/consts";
import {
  blockManager as createBlockManager,
  prefetchTransactions,
} from "@/lib/duneutils";
import {
  databaseConnection as createConnection,
  Models,
  ISetting,
  IEvent,
  IAddress,
  IDune,
  ITransaction,
} from "@/database/createConnection";
import { processBlock, loadBlockIntoMemory } from "@/lib/indexer";

import {
  BTC_RPC_URL,
  BTC_RPC_USERNAME,
  BTC_RPC_PASSWORD,
  RPC_PORT,
} from "@/lib/consts";

/* ──────────────────────────────────────────────────────────
   rpc client (single instance)
   ──────────────────────────────────────────────────────── */
const rpcClient = createRpcClient({
  url: BTC_RPC_URL,
  username: BTC_RPC_USERNAME,
  password: BTC_RPC_PASSWORD,
});

const { callRpc, callRpcBatch } = rpcClient;

/* ──────────────────────────────────────────────────────────
   test‑block for --test mode
   ──────────────────────────────────────────────────────── */
const testblock = JSON.parse(
  fs.readFileSync(path.join(__dirname, "./dumps/testblock.json"), "utf8")
) as unknown;

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
  dune: IDune | null;
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

    const foundDune = findOne<IDune>(
      "Dune",
      `${event.dune_id}@REF@id`,
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
      !foundDune ||
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
      dune: foundDune,
      from: foundAddressFrom,
      to: foundAddressTo,
    };
  });
};
/* ──────────────────────────────────────────────────────────
   RPC server (express)
   ──────────────────────────────────────────────────────── */
const startRpc = async (): Promise<void> => {
  log("Connecting to DB  » rpc", "info");
  const db = await createConnection();

  log("Starting RPC server", "info");
  const app: Application = express();
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());

  /* injector & auth */
  const injector: RequestHandler = (
    req: RequestWithDB,
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
  app.use(injector);

  /* mount routes — default exports */
  app.use("/dunes/events", (await import("@/rpc/dunes/routes/events")).default);
  app.use(
    "/dunes/balances",
    (await import("@/rpc/dunes/routes/balances")).default
  );
  app.use("/dunes/rpc", (await import("@/rpc/dunes/routes/rpc")).default);
  app.use("/dunes/utxos", (await import("@/rpc/dunes/routes/utxos")).default);
  app.use(
    "/dunes/etchings",
    (await import("@/rpc/dunes/routes/etchings")).default
  );

  app.listen(Number(RPC_PORT ?? 3030), () =>
    log(`RPC server running on :${RPC_PORT}`, "info")
  );
};

/* ──────────────────────────────────────────────────────────
   indexer  (block‑sync loop)
   ──────────────────────────────────────────────────────── */
const startServer = async (): Promise<void> => {
  if (!global.gc) {
    log("Run Node with  --expose-gc  to enable manual GC", "error");
    return;
  }

  const freshDb = process.argv.includes("--new");
  const useTest = process.argv.includes("--test");

  const storage = await newStorage(freshDb);
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

  /* optional prefetch once */
  if (!prefetched) {
    const count = Number(process.env.PREFETCH_BLOCKS ?? "100");
    const heights = Array.from(
      { length: count },
      (_, i) => GENESIS_BLOCK - count + i
    );
    log(`Prefetching ${count} blocks for fast indexing …`, "info");
    await prefetchTransactions(heights, storage, callRpcBatch);
    await storage.commitChanges();
    await writeInt("prefetch", 1);
    log("Prefetch complete", "info");
  }

  const blockStorage = await newStorage();
  /* block‑manager */
  const blockManager = await createBlockManager(
    callRpcBatch,
    lastProcessed,
    blockStorage
  );

  let current = lastProcessed ? lastProcessed + 1 : GENESIS_BLOCK;
  log(`Indexer starting at height ${current}`, "info");

  /* infinite sync loop */
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const tip = Number(await callRpc("getblockcount", []));
    if (current <= tip) {
      await processRange(current, tip);
      current = tip + 1;
    }
    await sleep(Number(process.env.BLOCK_CHECK_INTERVAL ?? "15000"));
  }

  /* inner helper – inclusive range, chunked */
  async function processRange(start: number, end: number): Promise<void> {
    const chunk = Number(process.env.MAX_STORAGE_BLOCK_CACHE_SIZE ?? "10");

    for (let h = start; h <= end; h += chunk) {
      const hi = Math.min(h + chunk - 1, end);
      const list = Array.from({ length: hi - h + 1 }, (_, i) => h + i);

      const blocks = useTest
        ? [testblock as any]
        : await Promise.all(list.map((v) => blockManager.getBlock(v)));

      await Promise.all(
        blocks.map((block) => loadBlockIntoMemory(block, storage))
      );
      blocks.forEach((b, i) =>
        processBlock(
          { blockHeight: list[i], blockData: b },
          rpcClient,
          storage,
          useTest
        )
      );

      await emitEvents(storage);
      await storage.commitChanges();
      await writeInt("last_block_processed", hi);
      log(`Processed ${h}…${hi}`, "info");
    }
  }
};

(async () => {
  if (process.argv.includes("--server")) await startServer();
  if (process.argv.includes("--rpc")) await startRpc();
})();
