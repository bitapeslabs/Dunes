require("dotenv").config({ path: "../.env" });

const { checkCommitment } = require("../src/lib/mezcalutils");
const { createRpcClient } = require("../src/lib/btcrpc");

const start = async () => {
  const callRpc = createRpcClient({
    url: process.env.BTC_RPC_URL,
    username: process.env.BTC_RPC_USERNAME,
    password: process.env.BTC_RPC_PASSWORD,
  });

  let Tx = await callRpc("getrawtransaction", [
    "d055fa45367a25be9a6007b43c14b7cd2fcb560e04af28e1b45e4496f4a352cc",
    true,
  ]);

  let commitCheck = await checkCommitment("MEZCAL", Tx, 841675, callRpc);

  console.log(commitCheck);
};

start();
