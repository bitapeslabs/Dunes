const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define('Runestone', {
        id: {
            type: Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        rune_id: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        transaction_id: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        edict_index: {
            type: Sequelize.INTEGER,
            allowNull: false
        },
        type: {
            type: Sequelize.TEXT('medium'),
            allowNull: true
        },
        value: {

            //We dont know the potential length of a rune, so its best to save directly as a string and do processing

            type: Sequelize.TEXT('medium'),
            allowNull: false
        }
    }, {
        tableName: 'runestones',
        timestamps: true,
        createdAt: true,
        updatedAt: true
    });
}

