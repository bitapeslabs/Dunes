const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "Event",
    {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      type: {
        type: Sequelize.TEXT("tiny"),
        allowNull: false,
      },

      block: {
        //address:rune_protocol_id -> address:block:vout

        type: Sequelize.INTEGER,
        allowNull: false,
      },

      transaction_hash: {
        type: Sequelize.TEXT("medium"),
        allowNull: false,
      },

      rune_protocol_id: {
        type: Sequelize.TEXT("tiny"),
        allowNull: false,
      },

      rune_name: {
        type: Sequelize.TEXT("tiny"),
        allowNull: false,
      },

      rune_raw_name: {
        type: Sequelize.TEXT("tiny"),
        allowNull: false,
      },
      amount: {
        type: Sequelize.TEXT("medium"),
        allowNull: false,
      },
      from: {
        type: Sequelize.TEXT("medium"),
        allowNull: false,
      },
      to: {
        type: Sequelize.TEXT("medium"),
        allowNull: false,
      },
    },
    {
      indexes: [
        {
          fields: ["block"],
          using: "HASH",
        },
        {
          fields: ["rune_protocol_id"],
          using: "HASH",
        },
        {
          fields: ["transaction_hash"],
          using: "HASH",
        },
        {
          fields: ["from"],
          using: "HASH",
        },
        {
          fields: ["to"],
          using: "HASH",
        },
      ],
      tableName: "events",
      timestamps: true,
      createdAt: true,
      updatedAt: true,
    }
  );
};
