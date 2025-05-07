const { Sequelize } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
    "Event",
    {
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      type: {
        //0 -> Etch
        //1 -> Mint
        //2 -> Transfer
        //3 -> Burn
        //We store as ints to save space on the database
        type: Sequelize.INTEGER,
        allowNull: false,
      },

      block: {
        //address:dune_protocol_id -> address:block:vout

        type: Sequelize.INTEGER,
        allowNull: false,
      },

      transaction_id: {
        type: Sequelize.BIGINT,
        references: {
          model: "transactions",
          key: "id",
        },
        allowNull: true,
      },

      dune_id: {
        type: Sequelize.INTEGER,
        references: {
          model: "dunes",
          key: "id",
        },
        allowNull: true,
      },
      amount: {
        type: Sequelize.DECIMAL,
        allowNull: false,
      },

      from_address_id: {
        type: Sequelize.BIGINT,
        references: {
          model: "addresses",
          key: "id",
        },
        allowNull: true,
      },
      to_address_id: {
        type: Sequelize.BIGINT,
        references: {
          model: "addresses",
          key: "id",
        },
        allowNull: true,
      },
    },
    {
      indexes: [
        {
          fields: ["block"],
          using: "BTREE",
        },
        {
          fields: ["dune_id"],
          using: "BTREE",
        },
        {
          fields: ["transaction_id"],
          using: "BTREE",
        },
        {
          fields: ["from_address_id"],
          using: "BTREE",
        },
        {
          fields: ["to_address_id"],
          using: "BTREE",
        },
      ],
      tableName: "events",
      timestamps: false,
    }
  );
};
