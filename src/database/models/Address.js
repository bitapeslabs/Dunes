const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "Address",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      address: {
        type: DataTypes.TEXT,
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
