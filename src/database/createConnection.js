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
