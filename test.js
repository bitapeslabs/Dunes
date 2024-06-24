//const { runestone } = require("@runeapes/apeutils");
const { Rune, RuneId, Runestone, u32, u128 } = require("@ordjs/runestone");
const { getCommitment } = require("./src/lib/runeutils");
const { Script } = require("@cmdcode/tapscript");
const fs = require("fs");
const path = require("path");

const testEdictRune = JSON.parse(
  fs.readFileSync(path.join(__dirname, "./dumps/testEdictRune.json"), "utf8")
);

const batchDecode = async () => {
  let decodedScripts = testEdictRune.vin[0].txinwitness.map((item) => {
    try {
      let script = Script.decode(item);
      return script;
    } catch (e) {
      console.log(e);
      return false;
    }
  });

  console.log(decodedScripts);
};
//let commitment = getCommitment("RUNEAPESSHARES").toString("hex");
//console.log(getCommitment("RUNEAPESSHARES").toString("hex"));

//console.log(decoded);
const runestone = new Runestone({
  edicts: [{ id: new RuneId(113n, 1), amount: BigInt("600"), output: 0 }],
});
console.log(runestone.encipher());
