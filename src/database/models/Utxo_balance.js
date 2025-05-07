const { Sequelize } = require("sequelize");

//total: 64 bytes
module.exports = (sequelize) => {
  return sequelize.define(
    "Utxo_balance",
    {
      //8 bytes
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },

      utxo_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },
      //4 bytes
      dune_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },

      //16 bytes stored across two BIGINTS and concat. by the lib
      balance: {
        type: Sequelize.DECIMAL,
        allowNull: true,
      },
    },
    {
      indexes: [
        {
          //Composite index for fetching a utxo with transaction id and vout_index
          fields: ["utxo_id"],
          using: "BTREE",
        },

        {
          //Composite index for fetching the individual dune balance of an indiviudal UTXO
          fields: ["utxo_id", "dune_id"],
          using: "BTREE",
        },
      ],
      tableName: "utxo_balances",
      timestamps: false,
    }
  );
};
