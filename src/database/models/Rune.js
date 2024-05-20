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
        symbol: {
            type: Sequelize.STRING(1),
            allowNull: false
        },
        totalSupply: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        decimals: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        mintCap: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        premine: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        totalHolders: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        mintStartBlock: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        mintEndBlock: {
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