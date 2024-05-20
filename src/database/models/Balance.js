const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define('Balance', {
            id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                autoIncrement: true
            },
            rune_id: {
                type: Sequelize.INTEGER,
                allowNull: false
            },
            utxo_id: {
                type: Sequelize.INTEGER,
                allowNull: false
            },
            account_id: {
                type: Sequelize.INTEGER,
                allowNull: false
            },
            balance: {
                type: Sequelize.INTEGER,
                allowNull: false
            }
        }, {
            tableName: 'balances',
            timestamps: true,
            createdAt: true,
            updatedAt: true
    });
}