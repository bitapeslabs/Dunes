const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "Address",
    {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      address: {
        type: Sequelize.TEXT("medium"),
        allowNull: false,
      },
    },
    {
      indexes: [
        {
          fields: ["address"],
          using: "BTREE",
        },
      ],
      tableName: "addresses",
      timestamps: false,
    }
  );
};
