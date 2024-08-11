const { Sequelize } = require("sequelize");
const { log } = require("../lib/utils");

async function databaseConnection() {
  return new Promise(async function (resolve, reject) {
    let models = {};

    const sequelize = new Sequelize(
      `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
      {
        logging: false,
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

    models.Utxo_balance.belongsTo(models.Utxo, { foreignKey: "utxo_id" });

    // Relationships UTXOS
    models.Utxo.belongsTo(models.Address, { foreignKey: "address_id" });
    models.Utxo.belongsTo(models.Transaction, { foreignKey: "transaction_id" });
    models.Utxo.belongsTo(models.Transaction, {
      foreignKey: "transaction_spent_id",
    });

    // Relationships Runes
    models.Rune.belongsTo(models.Transaction, {
      foreignKey: "etch_transaction_id",
    });
    models.Rune.belongsTo(models.Address, {
      foreignKey: "deployer_address_id",
    });

    //Relationships Events
    models.Event.belongsTo(models.Transaction, {
      foreignKey: "transaction_id",
    });
    models.Event.belongsTo(models.Rune, { foreignKey: "rune_id" });
    models.Event.belongsTo(models.Address, { foreignKey: "from_address_id" });
    models.Event.belongsTo(models.Address, { foreignKey: "to_address_id" });

    // Relationships Balances
    models.Balance.belongsTo(models.Address, { foreignKey: "address_id" });
    models.Balance.belongsTo(models.Rune, { foreignKey: "rune_id" });

    //HasMany relationships
    // Utxo hasMany Utxo_balance
    models.Utxo.hasMany(models.Utxo_balance, { foreignKey: "utxo_id" });

    // Address hasMany Utxo
    models.Address.hasMany(models.Utxo, { foreignKey: "address_id" });

    // Transaction hasMany Utxo (for the `transaction_id`)
    models.Transaction.hasMany(models.Utxo, { foreignKey: "transaction_id" });

    // Transaction hasMany Utxo (for the `transaction_spent_id`)
    models.Transaction.hasMany(models.Utxo, {
      foreignKey: "transaction_spent_id",
    });

    // Transaction hasMany Rune (for the `etch_transaction_id`)
    models.Transaction.hasMany(models.Rune, {
      foreignKey: "etch_transaction_id",
    });

    // Address hasMany Rune (for the `deployer_address_id`)
    models.Address.hasMany(models.Rune, { foreignKey: "deployer_address_id" });

    // Transaction hasMany Event (for the `transaction_id`)
    models.Transaction.hasMany(models.Event, { foreignKey: "transaction_id" });

    // Rune hasMany Event (for the `rune_id`)
    models.Rune.hasMany(models.Event, { foreignKey: "rune_id" });

    // Address hasMany Event (for the `from_address_id`)
    models.Address.hasMany(models.Event, { foreignKey: "from_address_id" });

    // Address hasMany Event (for the `to_address_id`)
    models.Address.hasMany(models.Event, { foreignKey: "to_address_id" });

    // Address hasMany Balance (for the `address_id`)
    models.Address.hasMany(models.Balance, { foreignKey: "address_id" });

    // Rune hasMany Balance (for the `rune_id`)
    models.Rune.hasMany(models.Balance, { foreignKey: "rune_id" });

    models.sequelize = sequelize;

    log("Connecting to database...", "Database");

    try {
      console.log();
      await sequelize.authenticate();
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
