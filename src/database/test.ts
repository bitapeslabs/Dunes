import { databaseConnection } from "./createConnection";

async function testDatabase() {
  const db = await databaseConnection();

  const { UtxoBalance } = db;

  let found = await UtxoBalance.findOne({
    where: {
      id: 1,
    },
  });

  console.log("Found UtxoBalance:", found);
}

testDatabase();
