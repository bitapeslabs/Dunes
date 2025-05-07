const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "Balance",
    {
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },

      dune_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },
      address_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },
      balance: {
        type: Sequelize.DECIMAL,
        allowNull: false,
      },
    },
    {
      indexes: [
        {
          fields: ["address_id"],
          using: "BTREE",
        },

        {
          fields: ["address_id", "dune_id"],
          using: "BTREE",
        },

        {
          fields: ["dune_id"],
          using: "BTREE",
        },
      ],
      tableName: "balances",
      timestamps: false,
    }
  );
};
