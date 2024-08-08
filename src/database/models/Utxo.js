const { Sequelize } = require("sequelize");

//total: 64 bytes
module.exports = (sequelize) => {
  return sequelize.define(
    "Utxo",
    {
      //8 bytes
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },

      //8 bytes
      value_sats: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },

      //4 bytes
      block: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },

      //8 bytes
      transaction_id: {
        type: Sequelize.BIGINT,
        references: {
          model: "transactions",
          key: "id",
        },
        allowNull: true,
      },

      //4 bytes
      address_id: {
        type: Sequelize.BIGINT,
        references: {
          model: "addresses",
          key: "id",
        },
        allowNull: true,
      },

      //4 bytes
      rune_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },

      //16 bytes stored across two BIGINTS and concat. by the lib
      balance_0: {
        type: Sequelize.BIGINT,
        allowNull: true,
      },
      balance_1: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },

      //4 bytes
      vout_index: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },

      //4 bytes
      block_spent: {
        /*
                This exists so that the scanner can give insight into what account balances were at a specific block. 
                This is also useful because we can see if the transaction came from a previous address, or if it was from COINBASE (an edict or a mint)
                 => If the input utxo didnt have any runes, we can assume that the output was an etch or a mint.
            */
        type: Sequelize.INTEGER,
        allowNull: true,
      },

      //8 bytes
      transaction_spent_id: {
        //For transversing the chain and a rune transfer history
        type: Sequelize.BIGINT,
        references: {
          model: "transactions",
          key: "id",
        },
        allowNull: true,
      },
    },
    {
      indexes: [
        {
          //Composite index for fetching a utxo with transaction id and vout_index
          fields: ["transaction_id", "vout_index"],
          using: "BTREE",
        },

        {
          //Composite index for fetching the individual rune balance of an indiviudal UTXO
          fields: ["transaction_id", "vout_index", "rune_id"],
          using: "BTREE",
        },

        //Useful for fetching all utxos for an address at a specific block
        {
          fields: ["block_spent", "address_id"],
          using: "BTREE",
        },

        //Useful for get utxos by address
        {
          fields: ["address_id"],
          using: "BTREE",
        },

        //Useful for get utxos by transaction
        {
          fields: ["transaction_id"],
          using: "BTREE",
        },

        //Useful for get utxos by transaction_spent
        {
          fields: ["transaction_spent_id"],
          using: "BTREE",
        },
        //Useful to get all utxos created a specific block
        {
          fields: ["block"],
          using: "BTREE",
        },
        //Useful to get all utxos spent at a specific block
        {
          fields: ["block_spent"],
          using: "BTREE",
        },
      ],
      tableName: "utxos",
      timestamps: false,
    }
  );
};
