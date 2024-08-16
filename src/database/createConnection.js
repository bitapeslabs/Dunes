const { Sequelize } = require("sequelize");
const { log } = require("../lib/utils");

async function databaseConnection() {
  return new Promise(async function (resolve, reject) {
    let models = {};

    const sequelize = new Sequelize(
      `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
      {
        logging: console.log,
        dialect: "postgres",
        dialectOptions: {
          connectTimeout: 60000,
        },
      }
    );
    models.Rune = require("./models/Rune")(sequelize);
    models.Balance = require("./models/Balance")(sequelize);
    models.Utxo = require("./models/Utxo")(sequelize);
    models.Setting = require("./models/Settings")(sequelize);
    models.Event = require("./models/Events")(sequelize);
    models.Transaction = require("./models/Transaction")(sequelize);
    models.Address = require("./models/Address")(sequelize);
    models.Utxo_balance = require("./models/Utxo_balance")(sequelize);

    models.Utxo_balance.belongsTo(models.Utxo, {
      foreignKey: "utxo_id",
      as: "utxo",
    });
    models.Utxo_balance.belongsTo(models.Rune, {
      foreignKey: "rune_id",
      as: "rune",
    });

    // Relationships UTXOS
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

    // Relationships Runes
    models.Rune.belongsTo(models.Transaction, {
      foreignKey: "etch_transaction_id",
      as: "etch_transaction",
    });
    models.Rune.belongsTo(models.Address, {
      foreignKey: "deployer_address_id",
      as: "deployer_address",
    });

    //Relationships Events
    models.Event.belongsTo(models.Transaction, {
      foreignKey: "transaction_id",
      as: "transaction",
    });
    models.Event.belongsTo(models.Rune, { foreignKey: "rune_id", as: "rune" });
    models.Event.belongsTo(models.Address, {
      foreignKey: "from_address_id",
      as: "from_address",
    });
    models.Event.belongsTo(models.Address, {
      foreignKey: "to_address_id",
      as: "to_address",
    });

    // Relationships Balances
    models.Balance.belongsTo(models.Address, {
      foreignKey: "address_id",
      as: "address",
    });
    models.Balance.belongsTo(models.Rune, {
      foreignKey: "rune_id",
      as: "rune",
    });

    //HasMany relationships
    // Utxo hasMany Utxo_balance
    models.Utxo.hasMany(models.Utxo_balance, {
      foreignKey: "utxo_id",
      as: "utxos",
    });

    // Address hasMany Utxo
    models.Address.hasMany(models.Utxo, {
      foreignKey: "address_id",
      as: "utxos",
    });

    // Address hasMany Utxo
    models.Address.hasMany(models.Rune, {
      foreignKey: "deployer_address_id",
      as: "runes_etched",
    });

    // Transaction hasMany Utxo (for the `transaction_id`)
    models.Transaction.hasMany(models.Utxo, {
      foreignKey: "transaction_id",
      as: "utxos",
    });

    // Transaction hasMany Utxo (for the `transaction_spent_id`)
    models.Transaction.hasMany(models.Utxo, {
      foreignKey: "transaction_spent_id",
      as: "utxos_spent",
    });

    // Transaction hasMany Rune (for the `etch_transaction_id`)
    models.Transaction.hasMany(models.Rune, {
      foreignKey: "etch_transaction_id",
      at: "runes_etched",
    });

    // Transaction hasMany Event (for the `transaction_id`)
    models.Transaction.hasMany(models.Event, {
      foreignKey: "transaction_id",
      as: "all_events",
    });

    // Rune hasMany Event (for the `rune_id`)
    models.Rune.hasMany(models.Event, { foreignKey: "rune_id", as: "events" });

    // Address hasMany Event (for the `from_address_id`)
    models.Address.hasMany(models.Event, {
      foreignKey: "from_address_id",
      as: "to_events",
    });

    // Address hasMany Event (for the `to_address_id`)
    models.Address.hasMany(models.Event, {
      foreignKey: "to_address_id",
      as: "from_events",
    });

    // Address hasMany Balance (for the `address_id`)
    models.Address.hasMany(models.Balance, {
      foreignKey: "address_id",
      as: "balances",
    });

    // Rune hasMany Balance (for the `rune_id`)
    models.Rune.hasMany(models.Balance, {
      foreignKey: "rune_id",
      as: "holders",
    });

    models.Rune.hasMany(models.Utxo_balance, {
      foreignKey: "rune_id",
      as: "utxo_holders",
    });

    models.sequelize = sequelize;

    log("Connecting to database...", "Database");

    try {
      console.log();
      await sequelize.authenticate();
      log("Connected to database!", "Database");
    } catch (e) {
      log(e.toString(), "DatabaseError");
      log("Connecting to database...", "Database");
      return;
    }

    resolve(models);
  });
}

module.exports = {
  databaseConnection,
};
