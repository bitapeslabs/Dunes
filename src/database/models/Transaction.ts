import {
  Sequelize,
  DataTypes,
  Model,
  CreationOptional,
  InferCreationAttributes,
} from "sequelize";

/* ── 1. Plain TypeScript type ───────────────────── */
export type ITransaction = {
  id: string; // BIGINT → string
  hash: string;
  logs?: string; // TEXT → optional string
};

/* ── 2. Sequelize model ─────────────────────────── */
export class Transaction
  extends Model<ITransaction, InferCreationAttributes<Transaction>>
  implements ITransaction
{
  declare id: CreationOptional<string>;
  declare hash: string;
  declare logs?: string;

  static initialize(sequelize: Sequelize): typeof Transaction {
    Transaction.init(
      {
        id: {
          type: DataTypes.BIGINT,
          primaryKey: true,
          autoIncrement: true,
        },
        hash: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        logs: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
      },
      {
        sequelize,
        tableName: "transactions",
        timestamps: false,
        indexes: [
          {
            fields: ["hash"],
            using: "BTREE",
          },
        ],
      }
    );
    return Transaction;
  }
}
