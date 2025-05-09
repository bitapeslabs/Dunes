const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "Transaction",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      hash: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
    },
    {
      indexes: [
        {
          fields: ["hash"],
          using: "BTREE",
        },
      ],
      tableName: "transactions",
      timestamps: false,
    }
  );
};
