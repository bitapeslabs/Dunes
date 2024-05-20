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
        value: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        isCenotaph: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        stoneHex: {
            type: Sequelize.TEXT('long'),
            allowNull: true
        },
        stoneJson: {
            type: Sequelize.TEXT('long'),
            allowNull: true
        },
        scanData: {
            type: Sequelize.TEXT('long'),
            allowNull: true
        },
        hash: {
            type: Sequelize.TEXT('medium'),
            allowNull: true
        }
    }, {
        tableName: 'transactions',
        timestamps: true,
        createdAt: true,
        updatedAt: true
    });
}