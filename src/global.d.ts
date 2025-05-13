import { Models } from "@/database/createConnection";
import { RpcClient } from "@/lib/bitcoinrpc";
declare global {
  namespace Express {
    interface Request {
      db: Models;
      callRpc: RpcClient["callRpc"];
    }
  }
}
