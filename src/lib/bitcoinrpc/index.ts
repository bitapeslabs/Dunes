import axios, { AxiosInstance } from "axios";
import { log, chunkify } from "@/lib/utils";
import dotenv from "dotenv";

dotenv.config();

interface RpcConfig {
  url: string;
  username: string;
  password: string;
}

interface RpcRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: unknown[];
}

interface RpcResponse<T> {
  result?: T;
  error?: unknown;
  id: number | string;
}

export function createRpcClient(rpcConfig: RpcConfig) {
  let rpcQueue: { req: RpcRequest; id: string }[] = [];
  const rpcResults: Record<string, RpcResponse<unknown>> = {};

  const rpcClient: AxiosInstance = axios.create({
    baseURL: rpcConfig.url,
    auth: {
      username: rpcConfig.username,
      password: rpcConfig.password,
    },
    headers: {
      "Content-Type": "application/json",
    },
  });

  const queueRpcCallAndGetResult = <T>(
    request: RpcRequest
  ): Promise<RpcResponse<T>> => {
    const queueId = `${rpcQueue.length}:${Date.now()}`;
    rpcQueue.push({ req: request, id: queueId });
    rpcResults[queueId] = {} as RpcResponse<T>;

    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (
          rpcResults[queueId] &&
          Object.keys(rpcResults[queueId]).length > 0
        ) {
          resolve({ ...(rpcResults[queueId] as RpcResponse<T>) });
          delete rpcResults[queueId];
          clearInterval(interval);
        }
      }, 10);
    });
  };

  const callRpc = async <T>(
    method: string,
    params: unknown[] = []
  ): Promise<T> => {
    try {
      const response = await rpcClient.post<{ result: T }>("", {
        jsonrpc: "1.0",
        id: Date.now(),
        method,
        params,
      });
      return response.data.result;
    } catch (error) {
      log(`${error} on ${method}`, "panic");
      throw error;
    }
  };

  const callRpcBatch = async <T>(
    method: string,
    params: unknown[] = []
  ): Promise<T> => {
    try {
      const response = await queueRpcCallAndGetResult<T>({
        jsonrpc: "1.0",
        id: Date.now(),
        method,
        params,
      });
      return response.result as T;
    } catch (error) {
      log(`${error} on ${method}`, "panic");
      throw error;
    }
  };

  setInterval(async () => {
    if (!rpcQueue.length) return;
    const queueSnapshot = [...rpcQueue];
    rpcQueue = [];

    try {
      const batch = queueSnapshot.map((r) => r.req);
      const maxBatchSize = parseInt(
        process.env.RPC_MAX_BATCH_SIZE ?? "1000",
        10
      );
      const maxChunks = parseInt(process.env.MAX_CHUNKS_RPC ?? "3", 10);
      const chunks = chunkify(chunkify(batch, maxBatchSize), maxChunks);

      let batchResult: RpcResponse<unknown>[] = [];

      for (const chunkGroup of chunks) {
        log(
          `Processing ${
            chunkGroup.length
          } chunk(s) with lengths -> (${chunkGroup
            .map((b) => b.length)
            .join(", ")}) for RPC`,
          "debug"
        );

        const responses = await Promise.all(
          chunkGroup.map((chunk) => rpcClient.post("", chunk))
        );

        batchResult.push(
          ...responses
            .map((res) => res.data as RpcResponse<unknown>[])
            .flat()
            .filter(Boolean)
        );

        log(
          `Processed ${chunkGroup.length} chunk(s) with lengths -> (${chunkGroup
            .map((b) => b.length)
            .join(", ")}) for RPC`,
          "debug"
        );
      }

      queueSnapshot.forEach((req, idx) => {
        rpcResults[req.id] = batchResult[idx];
      });
    } catch (error) {
      log(`${error} on batch`, "panic");
      throw error;
    }
  }, parseInt(process.env.RPC_BATCH_INTERVAL ?? "100", 10));

  return {
    callRpc,
    callRpcBatch,
  };
}

export type RpcClient = ReturnType<typeof createRpcClient>;
export * from "./types";
