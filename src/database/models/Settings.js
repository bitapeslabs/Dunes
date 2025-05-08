const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "Setting",
    {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      name: {
        type: Sequelize.TEXT,

        allowNull: false,
      },
      value: {
        type: Sequelize.TEXT,
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
