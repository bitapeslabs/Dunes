const { Op, fn, col, where } = require("sequelize");

async function resolveDune(Dune, needle) {
  const looksLikeId = /^\d+:\d+$/.test(needle);

  return await Dune.findOne({
    where: looksLikeId
      ? { dune_protocol_id: needle }
      : where(fn("LOWER", col("name")), needle.toLowerCase()),
    order: [["name", "ASC"]], // deterministic when multiple case variants exist
    attributes: ["id", "dune_protocol_id", "dune"],
  });
}

module.exports = { resolveDune };
