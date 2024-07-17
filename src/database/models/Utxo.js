const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "Utxo",
    {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        //autoIncrement: true,
      },
      value_sats: {
        type: Sequelize.TEXT("tiny"),
        allowNull: false,
      },
      hash: {
        type: Sequelize.TEXT("medium"),
        allowNull: true,
      },
      address: {
        type: Sequelize.TEXT("medium"),
        allowNull: true,
      },
      rune_balances: {
        type: Sequelize.TEXT("medium"),
        allowNull: true,
      },
      block: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      vout_index: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      block_spent: {
        /*
                This exists so that the scanner can give insight into what account balances were at a specific block. 
                This is also useful because we can see if the transaction came from a previous address, or if it was from COINBASE (an edict or a mint)
                 => If the input utxo didnt have any runes, we can assume that the output was an etch or a mint.
            */
        type: Sequelize.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: "utxos",
      timestamps: true,
      createdAt: true,
      updatedAt: true,
    }
  );
};
