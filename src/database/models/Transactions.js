const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define('Transaction', {
        id: {
            type: Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        block_id: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        value_sats: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        tx_json: {
            type: Sequelize.TEXT('long'),
            allowNull: true
        },
        runestone: {
            type: Sequelize.TEXT('long'),
            allowNull: true
        },
        hash: {
            type: Sequelize.TEXT('medium'),
            allowNull: true
        },
        data: {
            type: Sequelize.TEXT('long'),
            allowNull: true
        }
    }, {
        tableName: 'transactions',
        timestamps: true,
        createdAt: true,
        updatedAt: true
    });
}