const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "Utxo",
    {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      utxo_index: {
        //hash:vout
        type: Sequelize.TEXT("medium"),
        allowNull: false,
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
      tx_hash_spent: {
        //For transversing the chain and a rune transfer history
        type: Sequelize.TEXT("medium"),
        allowNull: true,
      },
    },
    {
      indexes: [
        {
          fields: ["utxo_index"],
          using: "HASH",
        },
        {
          fields: ["hash"],
          using: "HASH",
        },
        {
          fields: ["address"],
          using: "HASH",
        },
        {
          fields: ["block"], // Specify the actual fields to be unique
          using: "HASH",
        },
      ],
      tableName: "utxos",
      timestamps: true,
      createdAt: true,
      updatedAt: true,
    }
  );
};
