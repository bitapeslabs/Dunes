import { Models } from "@/database/createConnection";

export async function resetTo(height: number, db: Models): Promise<void> {
  const { sequelize } = db;

  await sequelize.transaction({ autocommit: false }, async (transaction) => {
    await sequelize.query(
      `DELETE FROM utxo_balances AS ub
       USING utxos AS u
      WHERE ub.utxo_id = u.id
        AND u.block       >= $1`,
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
    await sequelize.query(`DELETE FROM addresses    WHERE block >= $1`, {
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
              SUM(ub.balance) AS balance
         FROM utxo_balances AS ub
         JOIN utxos         AS u ON u.id = ub.utxo_id
     GROUP BY u.address_id, ub.mezcal_id`,
      { transaction }
    );

    await sequelize.query(
      `UPDATE settings
      SET value      = $1::text,
          updatedAt  = NOW()
    WHERE name = 'last_block_processed'`,
      {
        bind: [String(height - 1)], // cast to text just like other settings
        transaction,
      }
    );
  });
}
