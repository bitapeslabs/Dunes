const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define('Rune', {
        id: {
            type: Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        runeId: {
            type: Sequelize.TEXT('tiny')	,
            allowNull: false
        },
        name: {
            type: Sequelize.TEXT('tiny')	,
            allowNull: false
        },
        raw_name: {
            type: Sequelize.TEXT('tiny')	,
            allowNull: false
        },
        symbol: {
            type: Sequelize.STRING(1),
            allowNull: false
        },
        spacers: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        total_supply: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        decimals: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        mint_cap: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        premine: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        total_holders: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        mint_start_block: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        mint_end_block: {
            type: Sequelize.INTEGER,
            allowNull: false
        }
    }, {
        tableName: 'runes',
        timestamps: true,
        createdAt: true,
        updatedAt: true
    });
}