const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "Balance",
    {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      balance_index: {
        //address:rune_protocol_id -> address:block:vout

        type: Sequelize.TEXT("medium"),
        allowNull: false,
      },
      rune_protocol_id: {
        type: Sequelize.TEXT("tiny"),
        allowNull: false,
      },
      address: {
        type: Sequelize.TEXT("long"),
        allowNull: false,
      },
      balance: {
        type: Sequelize.TEXT("medium"),
        allowNull: false,
      },
    },
    {
      indexes: [
        {
          fields: ["address"],
          using: "HASH",
        },
        {
          fields: ["rune_protocol_id"],
          using: "HASH",
        },
      ],
      tableName: "balances",
      timestamps: true,
      createdAt: true,
      updatedAt: true,
    }
  );
};
