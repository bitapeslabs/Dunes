import {
  Sequelize,
  DataTypes,
  Model,
  CreationOptional,
  InferCreationAttributes,
} from "sequelize";

/* ── 1. Plain TypeScript type ───────────────────── */
export type IUtxo = {
  id: string; // BIGINT → string
  value_sats: string; // BIGINT → string
  block: number;
  transaction_id: string | null; // BIGINT → string
  address_id: string | null; // BIGINT → string
  vout_index: number;
  block_spent: number | null;
  transaction_spent_id: string | null; // BIGINT → string
};

/* ── 2. Sequelize model ─────────────────────────── */
export class Utxo
  extends Model<IUtxo, InferCreationAttributes<Utxo>>
  implements IUtxo
{
  declare id: CreationOptional<string>;
  declare value_sats: string;
  declare block: number;
  declare transaction_id: string | null;
  declare address_id: string | null;
  declare vout_index: number;
  declare block_spent: number | null;
  declare transaction_spent_id: string | null;

  static initialize(sequelize: Sequelize): typeof Utxo {
    Utxo.init(
      {
        id: {
          type: DataTypes.BIGINT,
          primaryKey: true,
          autoIncrement: true,
        },
        value_sats: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },
        block: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        transaction_id: {
          type: DataTypes.BIGINT,
          allowNull: true,
          references: {
            model: "transactions",
            key: "id",
          },
        },
        address_id: {
          type: DataTypes.BIGINT,
          allowNull: true,
          references: {
            model: "addresses",
            key: "id",
          },
        },
        vout_index: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        block_spent: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        transaction_spent_id: {
          type: DataTypes.BIGINT,
          allowNull: true,
          references: {
            model: "transactions",
            key: "id",
          },
        },
      },
      {
        sequelize,
        tableName: "utxos",
        timestamps: false,
        indexes: [
          { fields: ["transaction_id", "vout_index"], using: "BTREE" },
          { fields: ["block", "block_spent", "address_id"], using: "BTREE" },
          { fields: ["block", "block_spent"], using: "BTREE" },
          { fields: ["address_id"], using: "BTREE" },
          { fields: ["transaction_id"], using: "BTREE" },
          { fields: ["transaction_spent_id"], using: "BTREE" },
          { fields: ["block"], using: "BTREE" },
          { fields: ["block_spent"], using: "BTREE" },
        ],
      }
    );
    return Utxo;
  }
}
