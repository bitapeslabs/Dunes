import {
  Sequelize,
  DataTypes,
  Model,
  CreationOptional,
  InferCreationAttributes,
} from "sequelize";

/* ── 1. Plain TypeScript type ───────────────────── */
export type IEvent = {
  id: string; // BIGINT → string
  type: number; // 0 = Etch, 1 = Mint, 2 = Transfer, 3 = Burn
  block: number;
  transaction_id: string | null; // BIGINT → string
  dune_id: number | null;
  amount: string; // DECIMAL → string
  from_address_id: string | null; // BIGINT → string
  to_address_id: string | null; // BIGINT → string
};

/* ── 2. Sequelize model ─────────────────────────── */
export class Event
  extends Model<IEvent, InferCreationAttributes<Event>>
  implements IEvent
{
  declare id: CreationOptional<string>;
  declare type: number;
  declare block: number;
  declare transaction_id: string | null;
  declare dune_id: number | null;
  declare amount: string;
  declare from_address_id: string | null;
  declare to_address_id: string | null;

  static initialize(sequelize: Sequelize): typeof Event {
    Event.init(
      {
        id: {
          type: DataTypes.BIGINT,
          primaryKey: true,
          autoIncrement: true,
        },
        type: {
          type: DataTypes.INTEGER,
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
        dune_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: {
            model: "dunes",
            key: "id",
          },
        },
        amount: {
          type: DataTypes.DECIMAL,
          allowNull: false,
        },
        from_address_id: {
          type: DataTypes.BIGINT,
          allowNull: true,
          references: {
            model: "addresses",
            key: "id",
          },
        },
        to_address_id: {
          type: DataTypes.BIGINT,
          allowNull: true,
          references: {
            model: "addresses",
            key: "id",
          },
        },
      },
      {
        sequelize,
        tableName: "events",
        timestamps: false,
        indexes: [
          { fields: ["block"], using: "BTREE" },
          { fields: ["dune_id"], using: "BTREE" },
          { fields: ["transaction_id"], using: "BTREE" },
          { fields: ["from_address_id"], using: "BTREE" },
          { fields: ["to_address_id"], using: "BTREE" },
        ],
      }
    );
    return Event;
  }
}
