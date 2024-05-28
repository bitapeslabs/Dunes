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
        value_sats: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        hash: {
            type: Sequelize.TEXT('medium'),
            allowNull: true
        },
        rune_balances: {
            type: Sequelize.TEXT('medium'),
            allowNull: true
        },
        vout_index: {
            type: Sequelize.INTEGER,
            allowNull: false
        }
    }, {
        tableName: 'utxos',
        timestamps: true,
        createdAt: true,
        updatedAt: true
    });
}
