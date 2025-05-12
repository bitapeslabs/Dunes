import { Router, Request, Response } from "express";
import {
  Models,
  IAddress,
  IUtxo,
  ITransaction,
} from "@/database/createConnection";
import { getSomeUtxoBalance, IJoinedUtxo } from "../lib/queries";
import { simplify } from "../../../lib/utils";

interface RequestWithDB extends Request {
  db: Models;
}

const router = Router();

/* ──────────────────────────────────────────────────────────────
   GET  /:address       → list all *unspent* UTXOs for address
   ──────────────────────────────────────────────────────────── */
router.get("/:address", async (req: RequestWithDB, res: Response) => {
  try {
    const { Address, Utxo, Transaction } = req.db;
    const { address: addressStr } = req.params;

    const addressRow = (await Address.findOne({
      where: { address: addressStr },
      attributes: ["id"],
    })) as IAddress | null;

    if (!addressRow) {
      res.status(404).json({ error: "Address not found" });
      return;
    }

    // ── main query — now returning PLAIN objects ──────────────
    const utxos = (await Utxo.findAll({
      where: { address_id: addressRow.id, block_spent: null },
      attributes: ["id", "value_sats", "block", "vout_index", "block_spent"],
      include: [
        {
          model: Transaction,
          as: "transaction",
          attributes: ["hash"],
          required: false,
        },
        {
          model: Transaction,
          as: "transaction_spent",
          attributes: ["hash"],
          required: false,
        },
      ],
      order: [["block", "ASC"]],
      raw: true, // ► plain object rows
      nest: true, // ► put joins under their alias keys
    })) as unknown as IJoinedUtxo[];

    const serialized = utxos.map((u) => ({
      id: u.id,
      value_sats: u.value_sats,
      block: u.block,
      vout_index: u.vout_index,
      block_spent: u.block_spent,
      transaction: u.transaction?.hash ?? null,
      transaction_spent: u.transaction_spent?.hash ?? null,
    }));

    res.json(serialized);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ──────────────────────────────────────────────────────────────
   GET  /balances/:address  → current dune balances for address
   ──────────────────────────────────────────────────────────── */
router.get("/balances/:address", async (req: RequestWithDB, res: Response) => {
  try {
    const { address } = req.params;
    const { UtxoBalance } = req.db;

    const query = getSomeUtxoBalance(req.db, {
      utxo: { address: { address }, block_spent: null },
    });

    const balances = (await UtxoBalance.findAll(query)) as unknown[];

    if (!balances.length) {
      res.json([]);
      return;
    }

    res.json(balances.map((b) => simplify(b)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
