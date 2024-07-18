const { type } = require("os");
const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "Rune",
    {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      rune_protocol_id: {
        type: Sequelize.TEXT("tiny"),
        allowNull: false,
      },
      name: {
        type: Sequelize.TEXT("tiny"),
        allowNull: false,
      },

      raw_name: {
        type: Sequelize.TEXT("tiny"),
        allowNull: false,
      },
      symbol: {
        type: Sequelize.STRING(1),
        allowNull: false,
      },
      spacers: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      total_supply: {
        type: Sequelize.TEXT("tiny"),
        allowNull: false,
      },
      decimals: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      premine: {
        type: Sequelize.TEXT("tiny"),
        allowNull: false,
      },
      total_holders: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      mints: {
        type: Sequelize.TEXT("tiny"),
        allowNull: false,
      },
      mint_cap: {
        type: Sequelize.TEXT("tiny"),
        allowNull: true,
      },
      mint_start: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      mint_end: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      mint_offset_start: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      mint_offset_end: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      mint_amount: {
        type: Sequelize.TEXT("tiny"),
        allowNull: true,
      },
      burnt_amount: {
        type: Sequelize.TEXT("tiny"),
        allowNull: true,
      },
      etch_transaction: {
        type: Sequelize.TEXT("medium"),
        allowNull: true,
      },

      unmintable: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
    },
    {
      tableName: "runes",
      timestamps: true,
      createdAt: true,
      updatedAt: true,
    }
  );
};
