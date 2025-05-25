import {
  Sequelize,
  DataTypes,
  Model,
  CreationOptional,
  InferCreationAttributes,
} from "sequelize";

export type IBalance = {
  id: string; // bigint coerced to string
  mezcal_id: string; // bigint coerced to string
  address_id: string; // bigint coerced to string
  balance: string; // decimal stored as string
};

export class Balance
  extends Model<IBalance, InferCreationAttributes<Balance>>
  implements IBalance
{
  declare id: CreationOptional<string>;
  declare mezcal_id: string;
  declare address_id: string;
  declare balance: string;

  static initialize(sequelize: Sequelize): typeof Balance {
    Balance.init(
      {
        id: {
          type: DataTypes.BIGINT,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        mezcal_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },
        address_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },
        balance: {
          type: DataTypes.DECIMAL,
          allowNull: false,
        },
      },
      {
        sequelize,
        tableName: "balances",
        timestamps: false,
        indexes: [
          { fields: ["address_id"], using: "BTREE" },
          { fields: ["address_id", "mezcal_id"], using: "BTREE" },
          { fields: ["mezcal_id"], using: "BTREE" },
        ],
      }
    );
    return Balance;
  }
}
