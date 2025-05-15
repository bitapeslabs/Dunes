import express from "express";
const router = express.Router();
import { Op, WhereOptions } from "sequelize";

import { process_many_utxo_balances } from "../lib/native/pkg/mezcal_parsers.js";
import { validators } from "../lib/validators.js";
import {
  parseBalancesIntoUtxo,
  parseBalancesIntoAddress,
} from "../lib/parsers.js";
import { getSomeUtxoBalance, getSomeAddressBalance } from "../lib/queries.js";
import { IJoinedBalanceInstance } from "../lib/queries.js";
import { IUtxoBalance, IUtxo, IAddress } from "@/database/models/types";
type testType = WhereOptions<IUtxo>;

// — Get UTXO balances (all mezcals) —
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

// — Get UTXO balance (specific mezcal) —
router.get("/utxo/:utxo_index/:mezcal_protocol_id", async function (req, res) {
  try {
    const { db } = req;
    const { mezcal_protocol_id, utxo_index } = req.params;
    const { validTransactionHash, validInt, validProtocolId } = validators;

    const [hash, vout] = utxo_index?.split(":");

    if (!validTransactionHash(hash) || !validInt(vout)) {
      res.status(400).send({ error: "Invalid utxo index provided" });
      return;
    }

    if (!validProtocolId(mezcal_protocol_id)) {
      res.status(400).send({ error: "Invalid mezcal protocol id" });
      return;
    }

    const query = getSomeUtxoBalance(db, {
      utxo: { transaction: { hash }, vout_index: vout },
      mezcal: { mezcal_protocol_id },
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

// — Get address balances (all mezcals) —
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

// — Get address balance (specific mezcal) —
router.get("/address/:address/:mezcal_protocol_id", async function (req, res) {
  try {
    const { db } = req;
    const { address, mezcal_protocol_id } = req.params;
    const { validProtocolId } = validators;

    if (!validProtocolId(mezcal_protocol_id)) {
      res.status(400).send({ error: "Invalid mezcal protocol id provided" });
      return;
    }

    const query = getSomeAddressBalance(db, {
      address: { address },
      mezcal: { mezcal_protocol_id },
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

// — Snapshot balances over a range (all mezcals) —
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

// — Snapshot balances over a range (specific mezcal) —
router.get(
  "/snapshot/:start_block/:end_block/address/:address/:mezcal_protocol_id",
  async function (req, res) {
    try {
      const { db } = req;
      const { address, start_block, end_block, mezcal_protocol_id } =
        req.params;
      const { validInt, validProtocolId } = validators;

      if (!validInt(start_block) || !validInt(end_block)) {
        res.status(400).send({ error: "Invalid block range provided" });
        return;
      }

      if (!validProtocolId(mezcal_protocol_id)) {
        res.status(400).send({ error: "Invalid mezcal protocol id" });
        return;
      }

      const query = getSomeUtxoBalance(db, {
        utxo: {
          address: { address },
          block: { [Op.lte]: parseInt(end_block) },
        },
        mezcal: { mezcal_protocol_id },
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
