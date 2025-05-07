const { type } = require("os");
const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "Dune",
    {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      dune_protocol_id: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      name: {
        type: Sequelize.TEXT,
        allowNull: false,
      },

      symbol: {
        type: Sequelize.STRING(1),
        allowNull: false,
      },
      total_supply: {
        type: Sequelize.DECIMAL,
        allowNull: false,
      },
      decimals: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      premine: {
        type: Sequelize.DECIMAL,
        allowNull: false,
      },
      mints: {
        type: Sequelize.DECIMAL,
        allowNull: false,
      },
      mint_cap: {
        type: Sequelize.DECIMAL,
        allowNull: true,
      },
      mint_start: {
        type: Sequelize.DECIMAL,
        allowNull: true,
      },
      mint_end: {
        type: Sequelize.DECIMAL,
        allowNull: true,
      },
      mint_offset_start: {
        type: Sequelize.DECIMAL,
        allowNull: true,
      },
      mint_offset_end: {
        type: Sequelize.DECIMAL,
        allowNull: true,
      },
      mint_amount: {
        type: Sequelize.DECIMAL,
        allowNull: true,
      },
      burnt_amount: {
        type: Sequelize.DECIMAL,
        allowNull: true,
      },
      etch_transaction_id: {
        type: Sequelize.BIGINT,
        references: {
          model: "transactions",
          key: "id",
        },
        allowNull: true,
      },
      deployer_address_id: {
        type: Sequelize.BIGINT,
        references: {
          model: "addresses",
          key: "id",
        },
        allowNull: true,
      },

      unmintable: {
        type: Sequelize.INTEGER,
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
