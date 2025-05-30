import {
  Sequelize,
  DataTypes,
  Model,
  CreationOptional,
  InferCreationAttributes,
} from "sequelize";

/* ── 1. Plain TypeScript type ───────────────────── */
export type IMezcal = {
  id: number;
  mezcal_protocol_id: string;
  block: number; // This field is not in the Sequelize model, but it's part of the type
  name: string;
  symbol: string;
  total_supply: string;
  decimals: number;
  premine: string;
  mints: string;
  price:
    | {
        amount: number;
        pay_to: string;
      }[]
    | null; // Postgres-only, can be null

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
export class Mezcal
  extends Model<IMezcal, InferCreationAttributes<Mezcal>>
  implements IMezcal
{
  declare id: CreationOptional<number>;
  declare mezcal_protocol_id: string;
  declare name: string;
  declare symbol: string;
  declare total_supply: string;
  declare decimals: number;
  declare premine: string;
  declare mints: string;

  declare mint_cap: string | null;
  declare mint_start: number | null;
  declare mint_end: number | null;
  declare mint_offset_start: number | null;
  declare mint_offset_end: number | null;
  declare price:
    | {
        amount: number;
        pay_to: string;
      }[]
    | null; // Postgres-only, can be null

  declare mint_amount: string | null;
  declare burnt_amount: string | null;
  declare etch_transaction_id: string | null;
  declare deployer_address_id: string | null;
  declare unmintable: number;
  declare block: number; // This field is not in the Sequelize model, but it's part of the type

  static initialize(sequelize: Sequelize): typeof Mezcal {
    Mezcal.init(
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        mezcal_protocol_id: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        block: {
          type: DataTypes.INTEGER,
          allowNull: false,
        }, // This field is not in the Sequelize model, but it's part of the type

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
        price: {
          type: DataTypes.ARRAY(DataTypes.JSONB), // Postgres-only
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
        tableName: "mezcals",
        timestamps: false,
        indexes: [
          { fields: ["mezcal_protocol_id"], using: "BTREE" },
          { fields: ["deployer_address_id"], using: "BTREE" },
          { fields: ["block"], using: "BTREE" },
          {
            name: "mezcals_lower_idx",
            using: "BTREE",
            fields: [
              sequelize.fn("lower", sequelize.col("name")) as unknown as string,
            ],
          },
        ],
      }
    );

    return Mezcal;
  }
}
