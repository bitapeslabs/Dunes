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
