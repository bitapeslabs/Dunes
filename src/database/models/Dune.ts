import {
  Sequelize,
  DataTypes,
  Model,
  CreationOptional,
  InferCreationAttributes,
} from "sequelize";

/* ── 1. Plain TypeScript type ───────────────────── */
export type IDune = {
  id: number;
  dune_protocol_id: string;
  name: string;
  symbol: string;
  total_supply: string;
  decimals: number;
  premine: string;
  mints: string;
  price_amount: number | null;
  price_pay_to: string | null;
  mint_cap: string | null;
  mint_start: number | null;
  mint_end: number | null;
  mint_offset_start: number | null;
  mint_offset_end: number | null;
  mint_amount: string | null;
  burnt_amount: string | null;
  etch_transaction_id: string | null; // BIGINT → string
  deployer_address_id: string | null; // BIGINT → string
  unmintable: number;
};

/* ── 2. Sequelize model ─────────────────────────── */
export class Dune
  extends Model<IDune, InferCreationAttributes<Dune>>
  implements IDune
{
  declare id: CreationOptional<number>;
  declare dune_protocol_id: string;
  declare name: string;
  declare symbol: string;
  declare total_supply: string;
  declare decimals: number;
  declare premine: string;
  declare mints: string;
  declare price_amount: number | null;
  declare price_pay_to: string | null;
  declare mint_cap: string | null;
  declare mint_start: number | null;
  declare mint_end: number | null;
  declare mint_offset_start: number | null;
  declare mint_offset_end: number | null;
  declare mint_amount: string | null;
  declare burnt_amount: string | null;
  declare etch_transaction_id: string | null;
  declare deployer_address_id: string | null;
  declare unmintable: number;

  static initialize(sequelize: Sequelize): typeof Dune {
    Dune.init(
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
          type: DataTypes.INTEGER, //expressed in satoshis so safe to use INTEGER
          allowNull: true,
        },
        price_pay_to: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        mint_cap: {
          type: DataTypes.DECIMAL, //height will always be a > u32::MAX
          allowNull: true,
        },
        mint_start: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        mint_end: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        mint_offset_start: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        mint_offset_end: {
          type: DataTypes.INTEGER,
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
          allowNull: true,
          references: {
            model: "transactions",
            key: "id",
          },
        },
        deployer_address_id: {
          type: DataTypes.BIGINT,
          allowNull: true,
          references: {
            model: "addresses",
            key: "id",
          },
        },
        unmintable: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
      },
      {
        sequelize,
        tableName: "dunes",
        timestamps: false,
        indexes: [
          { fields: ["dune_protocol_id"], using: "BTREE" },
          { fields: ["deployer_address_id"], using: "BTREE" },
          {
            name: "dunes_lower_idx",
            using: "BTREE",
            fields: [
              sequelize.fn("lower", sequelize.col("name")) as unknown as string,
            ],
          },
        ],
      }
    );

    return Dune;
  }
}
