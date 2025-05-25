import { Sequelize } from "sequelize";
import { log } from "@/lib/utils";
import {
  Mezcal,
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
  Mezcal: typeof Mezcal;
  Balance: typeof Balance;
  Utxo: typeof Utxo;
  Setting: typeof Setting;
  Event: typeof Event;
  Transaction: typeof Transaction;
  Address: typeof Address;
  Utxo_balance: typeof UtxoBalance;
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
  models.Mezcal = Mezcal.initialize(sequelize);
  models.Balance = Balance.initialize(sequelize);
  models.Utxo = Utxo.initialize(sequelize);
  models.Setting = Setting.initialize(sequelize);
  models.Event = Event.initialize(sequelize);
  models.Transaction = Transaction.initialize(sequelize);
  models.Address = Address.initialize(sequelize);
  models.Utxo_balance = UtxoBalance.initialize(sequelize);

  // Set up associations
  models.Utxo_balance.belongsTo(models.Utxo, {
    foreignKey: "utxo_id",
    as: "utxo",
  });
  models.Utxo_balance.belongsTo(models.Mezcal, {
    foreignKey: "mezcal_id",
    as: "mezcal",
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

  models.Mezcal.belongsTo(models.Transaction, {
    foreignKey: "etch_transaction_id",
    as: "etch_transaction",
  });
  models.Mezcal.belongsTo(models.Address, {
    foreignKey: "deployer_address_id",
    as: "deployer_address",
  });

  models.Event.belongsTo(models.Transaction, {
    foreignKey: "transaction_id",
    as: "transaction",
  });
  models.Event.belongsTo(models.Mezcal, {
    foreignKey: "mezcal_id",
    as: "mezcal",
  });
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
  models.Balance.belongsTo(models.Mezcal, {
    foreignKey: "mezcal_id",
    as: "mezcal",
  });

  models.Utxo.hasMany(models.Utxo_balance, {
    foreignKey: "utxo_id",
    as: "utxos",
  });
  models.Address.hasMany(models.Utxo, {
    foreignKey: "address_id",
    as: "utxos",
  });
  models.Address.hasMany(models.Mezcal, {
    foreignKey: "deployer_address_id",
    as: "mezcals_etched",
  });

  models.Transaction.hasMany(models.Utxo, {
    foreignKey: "transaction_id",
    as: "utxos",
  });
  models.Transaction.hasMany(models.Utxo, {
    foreignKey: "transaction_spent_id",
    as: "utxos_spent",
  });
  models.Transaction.hasMany(models.Mezcal, {
    foreignKey: "etch_transaction_id",
    as: "mezcals_etched",
  });
  models.Transaction.hasMany(models.Event, {
    foreignKey: "transaction_id",
    as: "all_events",
  });

  models.Mezcal.hasMany(models.Event, {
    foreignKey: "mezcal_id",
    as: "events",
  });
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
  models.Mezcal.hasMany(models.Balance, {
    foreignKey: "mezcal_id",
    as: "holders",
  });
  models.Mezcal.hasMany(models.Utxo_balance, {
    foreignKey: "mezcal_id",
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
