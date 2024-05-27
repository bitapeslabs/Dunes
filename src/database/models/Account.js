const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define('Account', {
        id: {
            type: Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        address: {
            type: Sequelize.TEXT('tiny'),
            allowNull: false
        },
        utxo_list: {

            //JSON that contains array of all utxo ids and identifiers belonging to an address
            type: Sequelize.TEXT('long'),
            allowNull: false
        }


        //Balances from balances model
    }, {
        tableName: 'accounts',
        timestamps: true,
        createdAt: true,
        updatedAt: true
    });
}