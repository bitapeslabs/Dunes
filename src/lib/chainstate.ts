import { Models } from "@/database/createConnection";

export async function rollbackIndexerStateTo(
  height: number,
  db: Models
): Promise<void> {
  const { sequelize } = db;

  await sequelize.transaction(async (transaction) => {
    await sequelize.query(
      `DELETE FROM utxo_balances AS ub
         USING utxos AS u
        WHERE ub.utxo_id = u.id
          AND u.block >= $1`,
      { bind: [height], transaction }
    );

    await sequelize.query(`DELETE FROM utxos WHERE block >= $1`, {
      bind: [height],
      transaction,
    });

    await sequelize.query(
      `UPDATE utxos
          SET block_spent = NULL,
              transaction_spent_id = NULL
        WHERE block_spent >= $1`,
      { bind: [height], transaction }
    );

    await sequelize.query(`DELETE FROM events       WHERE block >= $1`, {
      bind: [height],
      transaction,
    });
    await sequelize.query(`DELETE FROM transactions WHERE block >= $1`, {
      bind: [height],
      transaction,
    });

    await sequelize.query(`TRUNCATE balances RESTART IDENTITY`, {
      transaction,
    });

    await sequelize.query(
      `INSERT INTO balances (address_id, mezcal_id, balance)
         SELECT u.address_id,
                ub.mezcal_id,
                SUM(COALESCE(ub.balance, 0)) AS balance
           FROM utxo_balances AS ub
           JOIN utxos         AS u ON u.id = ub.utxo_id
          WHERE u.block_spent IS NULL
       GROUP BY u.address_id, ub.mezcal_id`,
      { transaction }
    );

    await sequelize.query(`DELETE FROM addresses WHERE block >= $1`, {
      bind: [height],
      transaction,
    });

    await sequelize.query(`DELETE FROM mezcals WHERE block >= $1`, {
      bind: [height],
      transaction,
    });

    await sequelize.query(
      `UPDATE mezcals
      SET mints         = 0,
          burnt_amount  = 0,
          total_supply  = premine`,
      { transaction }
    );

    await sequelize.query(
      `UPDATE mezcals AS m
      SET mints         = s.cnt_mints,
          burnt_amount  = s.sum_burns,
          total_supply  = (s.cnt_mints::numeric * COALESCE(m.mint_amount, 0))
                         + m.premine
     FROM (
       SELECT mezcal_id,
              COUNT(*) FILTER (WHERE type = 1)                AS cnt_mints,
              COALESCE(SUM(CASE WHEN type = 3 THEN amount END), 0) AS sum_burns
         FROM events
        GROUP BY mezcal_id
     ) AS s
    WHERE m.id = s.mezcal_id`,
      { transaction }
    );

    await sequelize.query(
      `UPDATE settings
          SET value      = $1::text,
              "updatedAt" = NOW()
        WHERE name = 'last_block_processed'`,
      { bind: [String(height - 1)], transaction }
    );
  });
}
