import { Op, fn, col, where as sequelizeWhere } from "sequelize";
import { ModelStatic } from "sequelize/types";
import { IMezcal } from "@/database/createConnection";

/**
 * Resolves a mezcal by protocol ID or case-insensitive name.
 * @param Mezcal - Sequelize model for the Mezcal table
 * @param needle - mezcal_protocol_id (e.g., "843245:0") or mezcal name
 */
export async function resolveMezcal(
  Mezcal: ModelStatic<any>,
  needle: string
): Promise<Pick<IMezcal, "id" | "mezcal_protocol_id" | "name"> | null> {
  const looksLikeId = /^\d+:\d+$/.test(needle);

  const mezcal = await Mezcal.findOne({
    where: looksLikeId
      ? { mezcal_protocol_id: needle }
      : sequelizeWhere(fn("LOWER", col("name")), needle.toLowerCase()),
    order: [["name", "ASC"]],
    attributes: ["id", "mezcal_protocol_id", "name"],
  });

  return mezcal
    ? (mezcal.toJSON() as Pick<IMezcal, "id" | "mezcal_protocol_id" | "name">)
    : null;
}
