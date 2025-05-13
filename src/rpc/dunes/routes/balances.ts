import express from "express";
const router = express.Router();
import { Op, WhereOptions } from "sequelize";

import { process_many_utxo_balances } from "../lib/native/pkg/dune_parsers.js";
import { validators } from "../lib/validators";
import {
  parseBalancesIntoUtxo,
  parseBalancesIntoAddress,
} from "../lib/parsers";
import { getSomeUtxoBalance, getSomeAddressBalance } from "../lib/queries";
import { IJoinedBalanceInstance } from "../lib/queries";
import { IUtxoBalance, IUtxo, IAddress } from "@/database/models/types";
type testType = WhereOptions<IUtxo>;

// — Get UTXO balances (all dunes) —
router.get("/utxo/:utxo_index", async function (req, res) {
  try {
    const { db } = req;
    const { validTransactionHash, validInt } = validators;
    const [hash, vout] = req.params.utxo_index?.split(":");

    if (!validTransactionHash(hash) || !validInt(vout)) {
      res.status(400).send({ error: "Invalid utxo index provided" });
      return;
    }

    const query = getSomeUtxoBalance(db, {
      utxo: { transaction: { hash }, vout_index: vout },
    });

    const results = await db.Utxo_balance.findAll(query);
    if (!results?.length) {
      res.send({ error: "No UTXO found" });
      return;
    }

    const parsed = parseBalancesIntoUtxo(results.map((b) => b.toJSON()));
    res.send(parsed);
    return;
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: "Internal server error" });
    return;
  }
});

// — Get UTXO balance (specific dune) —
router.get("/utxo/:utxo_index/:dune_protocol_id", async function (req, res) {
  try {
    const { db } = req;
    const { dune_protocol_id, utxo_index } = req.params;
    const { validTransactionHash, validInt, validProtocolId } = validators;

    const [hash, vout] = utxo_index?.split(":");

    if (!validTransactionHash(hash) || !validInt(vout)) {
      res.status(400).send({ error: "Invalid utxo index provided" });
      return;
    }

    if (!validProtocolId(dune_protocol_id)) {
      res.status(400).send({ error: "Invalid dune protocol id" });
      return;
    }

    const query = getSomeUtxoBalance(db, {
      utxo: { transaction: { hash }, vout_index: vout },
      dune: { dune_protocol_id },
    });

    const results = await db.Utxo_balance.findAll(query);
    if (!results?.length) {
      res.send({ error: "No UTXO found" });
      return;
    }

    const parsed = parseBalancesIntoUtxo(results.map((b) => b.toJSON()));
    res.send(parsed);
    return;
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: "Internal server error" });
    return;
  }
});

// — Get address balances (all dunes) —
router.get("/address/:address", async function (req, res) {
  try {
    const { db } = req;
    const { address } = req.params;

    const query = getSomeAddressBalance(db, { address: { address } });
    const results = (await db.Balance.findAll(
      query
    )) as unknown as IJoinedBalanceInstance[];

    if (!results?.length) {
      res.send({});
      return;
    }

    const parsed = parseBalancesIntoAddress(results.map((b) => b.toJSON()));
    res.send(parsed);
    return;
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: "Internal server error" });
    return;
  }
});

// — Get address balance (specific dune) —
router.get("/address/:address/:dune_protocol_id", async function (req, res) {
  try {
    const { db } = req;
    const { address, dune_protocol_id } = req.params;
    const { validProtocolId } = validators;

    if (!validProtocolId(dune_protocol_id)) {
      res.status(400).send({ error: "Invalid dune protocol id provided" });
      return;
    }

    const query = getSomeAddressBalance(db, {
      address: { address },
      dune: { dune_protocol_id },
    });

    const results = (await db.Balance.findAll(
      query
    )) as unknown as IJoinedBalanceInstance[];
    if (!results?.length) {
      res.send({});
      return;
    }

    const parsed = parseBalancesIntoAddress(results.map((b) => b.toJSON()));
    res.send(parsed);
    return;
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: "Internal server error" });
    return;
  }
});

// — Snapshot balances over a range (all dunes) —
router.get(
  "/snapshot/:start_block/:end_block/address/:address",
  async function (req, res) {
    try {
      const { db } = req;
      const { address, start_block, end_block } = req.params;
      const { validInt } = validators;

      if (!validInt(start_block) || !validInt(end_block)) {
        res.status(400).send({ error: "Invalid block range provided" });
        return;
      }

      const query = getSomeUtxoBalance(db, {
        utxo: {
          address: { address },
          block: { [Op.lte]: parseInt(end_block) },
        },
      });

      const results = await db.Utxo_balance.findAll(query);
      if (!results?.length) {
        res.send({});
        return;
      }

      const parsed = JSON.parse(
        process_many_utxo_balances(
          JSON.stringify(results.map((b) => b.toJSON())),
          parseInt(start_block),
          parseInt(end_block)
        )
      );

      res.send(parsed);
      return;
    } catch (e) {
      console.log(e);
      res.status(500).send({ error: "Internal server error" });
      return;
    }
  }
);

// — Snapshot balances over a range (specific dune) —
router.get(
  "/snapshot/:start_block/:end_block/address/:address/:dune_protocol_id",
  async function (req, res) {
    try {
      const { db } = req;
      const { address, start_block, end_block, dune_protocol_id } = req.params;
      const { validInt, validProtocolId } = validators;

      if (!validInt(start_block) || !validInt(end_block)) {
        res.status(400).send({ error: "Invalid block range provided" });
        return;
      }

      if (!validProtocolId(dune_protocol_id)) {
        res.status(400).send({ error: "Invalid dune protocol id" });
        return;
      }

      const query = getSomeUtxoBalance(db, {
        utxo: {
          address: { address },
          block: { [Op.lte]: parseInt(end_block) },
        },
        dune: { dune_protocol_id },
      });

      const results = await db.Utxo_balance.findAll(query);
      if (!results?.length) {
        res.send({});
        return;
      }

      const parsed = JSON.parse(
        process_many_utxo_balances(
          JSON.stringify(results.map((b) => b.toJSON())),
          parseInt(start_block),
          parseInt(end_block)
        )
      );

      res.send(parsed);
      return;
    } catch (e) {
      console.log(e);
      res.status(500).send({ error: "Internal server error" });
      return;
    }
  }
);

export default router;
