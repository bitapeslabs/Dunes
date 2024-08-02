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
      from_address: {
        type: Sequelize.TEXT("medium"),
        allowNull: false,
      },
      to_address: {
        type: Sequelize.TEXT("medium"),
        allowNull: false,
      },
    },
    {
      indexes: [
        {
          fields: ["block"],
          using: "BTREE",
        },
        {
          fields: ["rune_protocol_id"],
          using: "BTREE",
        },
        {
          fields: ["transaction_hash"],
          using: "BTREE",
        },
        {
          fields: ["from_address"],
          using: "BTREE",
        },
        {
          fields: ["to_address"],
          using: "BTREE",
        },
      ],
      tableName: "events",
      timestamps: true,
      createdAt: true,
      updatedAt: true,
    }
  );
};
