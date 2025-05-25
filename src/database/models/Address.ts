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
};
export class Address
  extends Model<IAddress, InferCreationAttributes<Address>>
  implements IAddress
{
  declare id: CreationOptional<number>;
  declare address: string;

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
      },
      {
        sequelize,
        tableName: "addresses",
        timestamps: false,
        indexes: [
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
