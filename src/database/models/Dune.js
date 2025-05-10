const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define(
    "Dune",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      dune_protocol_id: {
        type: DataTypes.TEXT,
        allowNull: false,
      },

      // ------------- case‑insensitive “name” -------------
      name: {
        type: DataTypes.TEXT,
        allowNull: false,
      },

      symbol: {
        type: DataTypes.STRING(8),
        allowNull: false,
      },
      total_supply: {
        type: DataTypes.DECIMAL,
        allowNull: false,
      },
      decimals: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      premine: {
        type: DataTypes.DECIMAL,
        allowNull: false,
      },
      mints: {
        type: DataTypes.DECIMAL,
        allowNull: false,
      },
      price_amount: {
        type: DataTypes.DECIMAL,
        allowNull: true,
      },
      price_pay_to: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      mint_cap: {
        type: DataTypes.DECIMAL,
        allowNull: true,
      },
      mint_start: {
        type: DataTypes.DECIMAL,
        allowNull: true,
      },
      mint_end: {
        type: DataTypes.DECIMAL,
        allowNull: true,
      },
      mint_offset_start: {
        type: DataTypes.DECIMAL,
        allowNull: true,
      },
      mint_offset_end: {
        type: DataTypes.DECIMAL,
        allowNull: true,
      },
      mint_amount: {
        type: DataTypes.DECIMAL,
        allowNull: true,
      },
      burnt_amount: {
        type: DataTypes.DECIMAL,
        allowNull: true,
      },

      etch_transaction_id: {
        type: DataTypes.BIGINT,
        references: {
          model: "transactions",
          key: "id",
        },
        allowNull: true,
      },
      deployer_address_id: {
        type: DataTypes.BIGINT,
        references: {
          model: "addresses",
          key: "id",
        },
        allowNull: true,
      },

      unmintable: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      tableName: "dunes",
      timestamps: false,

      indexes: [
        // already‑existing BTREEs
        { fields: ["dune_protocol_id"], using: "BTREE" },
        { fields: ["deployer_address_id"], using: "BTREE" },

        // NEW: functional index for case‑insensitive look‑ups on name
        {
          name: "dunes_lower_idx",
          using: "BTREE",
          fields: [sequelize.fn("lower", sequelize.col("name"))],
        },
      ],
    }
  );
