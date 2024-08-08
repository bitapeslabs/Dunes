const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "Transaction",
    {
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      hash: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
    },
    {
      indexes: [
        {
          fields: ["hash"],
          using: "BTREE",
        },
      ],
      tableName: "transactions",
      timestamps: false,
    }
  );
};
