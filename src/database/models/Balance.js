const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "Balance",
    {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        //autoIncrement: true,
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
      tableName: "balances",
      timestamps: true,
      createdAt: true,
      updatedAt: true,
    }
  );
};
