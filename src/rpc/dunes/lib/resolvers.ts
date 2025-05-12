import { Op, fn, col, where as sequelizeWhere } from "sequelize";
import { ModelStatic } from "sequelize/types";
import { IDune } from "@/database/createConnection";

/**
 * Resolves a dune by protocol ID or case-insensitive name.
 * @param Dune - Sequelize model for the Dune table
 * @param needle - dune_protocol_id (e.g., "843245:0") or dune name
 */
export async function resolveDune(
  Dune: ModelStatic<any>,
  needle: string
): Promise<Pick<IDune, "id" | "dune_protocol_id" | "name"> | null> {
  const looksLikeId = /^\d+:\d+$/.test(needle);

  const dune = await Dune.findOne({
    where: looksLikeId
      ? { dune_protocol_id: needle }
      : sequelizeWhere(fn("LOWER", col("name")), needle.toLowerCase()),
    order: [["name", "ASC"]],
    attributes: ["id", "dune_protocol_id", "name"],
  });

  return dune
    ? (dune.toJSON() as Pick<IDune, "id" | "dune_protocol_id" | "name">)
    : null;
}
