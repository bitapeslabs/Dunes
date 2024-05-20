const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define('Utxo', {
        id: {
            type: Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        account_id: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        transaction_id: {
            type: Sequelize.INTEGER,
            allowNull: false
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
        tableName: 'utxos',
        timestamps: true,
        createdAt: true,
        updatedAt: true
    });
}
