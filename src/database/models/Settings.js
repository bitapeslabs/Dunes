const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "Setting",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      name: {
        type: DataTypes.TEXT,

        allowNull: false,
      },
      value: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "settings",
      timestamps: true,
      createdAt: true,
      updatedAt: true,
    }
  );
};
