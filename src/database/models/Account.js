const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define('Account', {
        id: {
            type: Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        address: {
            type: Sequelize.TEXT('tiny')	,
            allowNull: false
        }
    }, {
        tableName: 'accounts',
        timestamps: true,
        createdAt: true,
        updatedAt: true
    });
}