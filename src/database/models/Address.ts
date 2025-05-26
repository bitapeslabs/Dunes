// ── 2. Define the Sequelize model that implements it ─
import {
  Sequelize,
  DataTypes,
  Model,
  CreationOptional,
  InferCreationAttributes,
} from "sequelize";
export type IAddress = {
  id: number;
  address: string;
  block: number;
};
export class Address
  extends Model<IAddress, InferCreationAttributes<Address>>
  implements IAddress
{
  declare id: CreationOptional<number>;
  declare address: string;
  declare block: number;

  static initialize(sequelize: Sequelize): typeof Address {
    Address.init(
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        address: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        block: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
      },
      {
        sequelize,
        tableName: "addresses",
        timestamps: false,
        indexes: [
          { fields: ["block"], using: "BTREE" },
          {
            fields: ["address"],
            using: "BTREE",
          },
        ],
      }
    );
    return Address;
  }
}
