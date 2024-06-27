require("dotenv").config({ path: "../../.env" });
const { runestone } = require("@runeapes/apeutils");
const { stripObject } = require("./tools");

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
          //PUSHNUM_13 is CRUCIAL for defining a cenotaph, if just an "OP_RETURN" is present, its treated as a normal tx
          utxo.scriptPubKey.asm.includes("OP_RETURN 13")
        ).length),
  };
};

module.exports = {
  decipherRunestone,
};
