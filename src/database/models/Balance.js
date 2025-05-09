const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "Balance",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },

      dune_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      address_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      balance: {
        type: DataTypes.DECIMAL,
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
