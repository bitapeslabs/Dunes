const bitcoin = require("bitcoinjs-lib");
const network = bitcoin.networks.regtest;
const ecc = require("tiny-secp256k1");
bitcoin.initEccLib(ecc);

const tx = new bitcoin.Transaction({ network });

// Transaction Initializers
const txid = "0f8248cf7ae438c85c32a115a730598c2fde47c9f4105e271bbc4e05eaad61c6";
const vout = 1;

// Add the input
tx.addInput(Buffer.from(txid, "hex").reverse(), vout);

const embed = bitcoin.script.fromHEX(
  "OP_RETURN OP_13 007101ac0203".trim().replace(/\s+/g, " ")
);

console.log(embed);

tx.addOutput(embed, 546);

const recipient =
  "bcrt1pk87a3g4msa0kltpdesx2tp9qvzepvrsjg5m5q92d7jl9kqth4sxqe0d925";
const amount = 5000; // Amount in satoshis
const recipientScript = bitcoin.address.toOutputScript(recipient, network);
tx.addOutput(recipientScript, amount);

const txHex = tx.toHex();

console.log("Raw Unsigned Transaction Hex:", txHex);
