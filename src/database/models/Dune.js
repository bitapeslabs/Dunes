const { type } = require("os");
const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "Dune",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      dune_protocol_id: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      name: {
        type: DataTypes.TEXT,
        allowNull: false,
      },

      symbol: {
        type: DataTypes.STRING(8),
        allowNull: false,
      },
      total_supply: {
        type: DataTypes.DECIMAL,
        allowNull: false,
      },
      decimals: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      premine: {
        type: DataTypes.DECIMAL,
        allowNull: false,
      },
      mints: {
        type: DataTypes.DECIMAL,
        allowNull: false,
      },
      price_amount: {
        type: DataTypes.DECIMAL,
        allowNull: true,
      },
      price_pay_to: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      mint_cap: {
        type: DataTypes.DECIMAL,
        allowNull: true,
      },
      mint_start: {
        type: DataTypes.DECIMAL,
        allowNull: true,
      },
      mint_end: {
        type: DataTypes.DECIMAL,
        allowNull: true,
      },
      mint_offset_start: {
        type: DataTypes.DECIMAL,
        allowNull: true,
      },
      mint_offset_end: {
        type: DataTypes.DECIMAL,
        allowNull: true,
      },
      mint_amount: {
        type: DataTypes.DECIMAL,
        allowNull: true,
      },
      burnt_amount: {
        type: DataTypes.DECIMAL,
        allowNull: true,
      },
      etch_transaction_id: {
        type: DataTypes.BIGINT,
        references: {
          model: "transactions",
          key: "id",
        },
        allowNull: true,
      },
      deployer_address_id: {
        type: DataTypes.BIGINT,
        references: {
          model: "addresses",
          key: "id",
        },
        allowNull: true,
      },

      unmintable: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      indexes: [
        {
          fields: ["dune_protocol_id"],
          using: "BTREE", // Attempt to specify hash index
        },
        {
          fields: ["deployer_address_id"],
          using: "BTREE", // Attempt to specify hash index
        },
      ],
      tableName: "dunes",
      timestamps: false,
    }
  );
};
