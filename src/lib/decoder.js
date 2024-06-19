require("dotenv").config({ path: "../../.env" });
const { runestone } = require("@runeapes/apeutils");
const { stripObject } = require("./helpers");

const decipherRunestone = (txJson) => {
  let decodedBlob = stripObject(runestone.decipher(txJson.hex) ?? {});

  //Cenotaph objects and Runestones are both treated as runestones, the differentiation in processing is done at the indexer level
  return {
    ...decodedBlob?.Runestone,
    ...decodedBlob?.Cenotaph,
    cenotaph:
      !!decodedBlob?.Cenotaph ||
      (!decodedBlob?.Runestone &&
        !!txJson.vout.filter((utxo) =>
          utxo.scriptPubKey.asm.includes("OP_RETURN")
        ).length),
  };
};

module.exports = {
  decipherRunestone,
};
