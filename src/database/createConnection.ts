import { Sequelize } from "sequelize";
import { log } from "@/lib/utils";
import {
  Dune,
  Balance,
  Utxo,
  Setting,
  Event,
  Transaction,
  Address,
  UtxoBalance,
} from "./models/types";
import { DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME } from "@/lib/consts";

export const models = {} as Models;

export interface Models {
  Dune: typeof Dune;
  Balance: typeof Balance;
  Utxo: typeof Utxo;
  Setting: typeof Setting;
  Event: typeof Event;
  Transaction: typeof Transaction;
  Address: typeof Address;
  UtxoBalance: typeof UtxoBalance;
  sequelize: Sequelize;
}

export async function databaseConnection(forceSync = false): Promise<Models> {
  const sequelize = new Sequelize(
    `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`,
    {
      logging: false,
      dialect: "postgres",
      dialectOptions: {
        connectTimeout: 60000,
      },
    }
  );

  // Initialize models
  models.Dune = Dune.initialize(sequelize);
  models.Balance = Balance.initialize(sequelize);
  models.Utxo = Utxo.initialize(sequelize);
  models.Setting = Setting.initialize(sequelize);
  models.Event = Event.initialize(sequelize);
  models.Transaction = Transaction.initialize(sequelize);
  models.Address = Address.initialize(sequelize);
  models.UtxoBalance = UtxoBalance.initialize(sequelize);

  // Set up associations
  models.UtxoBalance.belongsTo(models.Utxo, {
    foreignKey: "utxo_id",
    as: "utxo",
  });
  models.UtxoBalance.belongsTo(models.Dune, {
    foreignKey: "dune_id",
    as: "dune",
  });

  models.Utxo.belongsTo(models.Address, {
    foreignKey: "address_id",
    as: "address",
  });
  models.Utxo.belongsTo(models.Transaction, {
    foreignKey: "transaction_id",
    as: "transaction",
  });
  models.Utxo.belongsTo(models.Transaction, {
    foreignKey: "transaction_spent_id",
    as: "transaction_spent",
  });

  models.Dune.belongsTo(models.Transaction, {
    foreignKey: "etch_transaction_id",
    as: "etch_transaction",
  });
  models.Dune.belongsTo(models.Address, {
    foreignKey: "deployer_address_id",
    as: "deployer_address",
  });

  models.Event.belongsTo(models.Transaction, {
    foreignKey: "transaction_id",
    as: "transaction",
  });
  models.Event.belongsTo(models.Dune, { foreignKey: "dune_id", as: "dune" });
  models.Event.belongsTo(models.Address, {
    foreignKey: "from_address_id",
    as: "from_address",
  });
  models.Event.belongsTo(models.Address, {
    foreignKey: "to_address_id",
    as: "to_address",
  });

  models.Balance.belongsTo(models.Address, {
    foreignKey: "address_id",
    as: "address",
  });
  models.Balance.belongsTo(models.Dune, { foreignKey: "dune_id", as: "dune" });

  models.Utxo.hasMany(models.UtxoBalance, {
    foreignKey: "utxo_id",
    as: "utxos",
  });
  models.Address.hasMany(models.Utxo, {
    foreignKey: "address_id",
    as: "utxos",
  });
  models.Address.hasMany(models.Dune, {
    foreignKey: "deployer_address_id",
    as: "dunes_etched",
  });

  models.Transaction.hasMany(models.Utxo, {
    foreignKey: "transaction_id",
    as: "utxos",
  });
  models.Transaction.hasMany(models.Utxo, {
    foreignKey: "transaction_spent_id",
    as: "utxos_spent",
  });
  models.Transaction.hasMany(models.Dune, {
    foreignKey: "etch_transaction_id",
    as: "dunes_etched",
  });
  models.Transaction.hasMany(models.Event, {
    foreignKey: "transaction_id",
    as: "all_events",
  });

  models.Dune.hasMany(models.Event, { foreignKey: "dune_id", as: "events" });
  models.Address.hasMany(models.Event, {
    foreignKey: "from_address_id",
    as: "to_events",
  });
  models.Address.hasMany(models.Event, {
    foreignKey: "to_address_id",
    as: "from_events",
  });
  models.Address.hasMany(models.Balance, {
    foreignKey: "address_id",
    as: "balances",
  });
  models.Dune.hasMany(models.Balance, { foreignKey: "dune_id", as: "holders" });
  models.Dune.hasMany(models.UtxoBalance, {
    foreignKey: "dune_id",
    as: "utxo_holders",
  });

  models.sequelize = sequelize;

  log("Connecting to database...", "Database");

  try {
    await sequelize.authenticate();
    log("Connected to database!", "Database");

    if (forceSync) {
      await sequelize.getQueryInterface().dropAllTables();
      await sequelize.sync({ force: true });
    } else {
      await sequelize.sync({ force: false });
    }

    return models;
  } catch (e) {
    log((e as Error).toString(), "DatabaseError");
    log("Retrying database connection...", "Database");
    throw e;
  }
}

export * from "./models/types";
