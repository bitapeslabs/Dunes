const { Sequelize } = require("sequelize");
const { log } = require("../lib/logger");

require("dotenv").config({ path: ".env" });

async function databaseConnection() {
  return new Promise(async function (resolve, reject) {
    let models = {};
    console.log(process.env.DB_NAME);
    const sequelize = new Sequelize(
      process.env.DB_NAME,
      process.env.DB_USER,
      process.env.DB_PASSWORD,
      {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        dialect: "mariadb",
        logging: false,
        dialectOptions: {
          connectTimeout: 60000,
        },
      }
    );

    models.Rune = require("./models/Rune")(sequelize);
    models.Account = require("./models/Account")(sequelize);
    models.Balance = require("./models/Balance")(sequelize);
    models.Transaction = require("./models/Transaction")(sequelize);
    models.Utxo = require("./models/Utxo")(sequelize);

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
