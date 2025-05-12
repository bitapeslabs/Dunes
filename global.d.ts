import { Models } from "@/database/createConnection";
declare global {
  namespace Express {
    interface Request {
      db: Models;
    }
  }
}
