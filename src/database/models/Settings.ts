import {
  Sequelize,
  DataTypes,
  Model,
  CreationOptional,
  InferCreationAttributes,
} from "sequelize";

/* ── 1. Plain TypeScript type ───────────────────── */
export type ISetting = {
  id: number;
  name: string;
  value: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/* ── 2. Sequelize model ─────────────────────────── */
export class Setting
  extends Model<ISetting, InferCreationAttributes<Setting>>
  implements ISetting
{
  declare id: CreationOptional<number>;
  declare name: string;
  declare value: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static initialize(sequelize: Sequelize): typeof Setting {
    Setting.init(
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        name: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        value: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        createdAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updatedAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
      },
      {
        sequelize,
        tableName: "settings",
        timestamps: true,
        createdAt: true,
        updatedAt: true,
      }
    );
    return Setting;
  }
}
