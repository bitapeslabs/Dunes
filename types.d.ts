import type { Sequelize, Model, ModelStatic } from "sequelize";

declare global {
  namespace Express {
    type Application = any;

    interface Request {
      callRpc: Function;
      db: {
        sequelize: Sequelize;

        Dune: ModelStatic<any>;
        Balance: ModelStatic<any>;
        Utxo: ModelStatic<any>;
        Setting: ModelStatic<any>;
        Event: ModelStatic<any>;
        Transaction: ModelStatic<any>;
        Address: ModelStatic<any>;
        Utxo_balance: ModelStatic<any>;
      };
    }
  }
}
