import {
  Sequelize,
  DataTypes,
  Model,
  CreationOptional,
  InferCreationAttributes,
} from "sequelize";

/* ── 1. Plain TypeScript type ───────────────────── */
export type IUtxoBalance = {
  id: string; // BIGINT → string
  utxo_id: string; // BIGINT → string
  dune_id: number;
  balance: string | null; // DECIMAL → string
};

/* ── 2. Sequelize model ─────────────────────────── */
export class UtxoBalance
  extends Model<IUtxoBalance, InferCreationAttributes<UtxoBalance>>
  implements IUtxoBalance
{
  declare id: CreationOptional<string>;
  declare utxo_id: string;
  declare dune_id: number;
  declare balance: string | null;

  static initialize(sequelize: Sequelize): typeof UtxoBalance {
    UtxoBalance.init(
      {
        id: {
          type: DataTypes.BIGINT,
          primaryKey: true,
          autoIncrement: true,
        },
        utxo_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },
        dune_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        balance: {
          type: DataTypes.DECIMAL,
          allowNull: true,
        },
      },
      {
        sequelize,
        tableName: "utxo_balances",
        timestamps: false,
        indexes: [
          { fields: ["utxo_id"], using: "BTREE" },
          { fields: ["utxo_id", "dune_id"], using: "BTREE" },
        ],
      }
    );
    return UtxoBalance;
  }
}
