const { Op, Sequelize } = require("sequelize");
const { stripFields } = require("../../../lib/utils");

const IncludeRune = (models, as, where) => ({
  model: models.Rune,
  as: as ?? "rune",
  where: stripFields(where, ["etch_transaction", "deployer_address"]),
  include: [
    IncludeTransaction(models, "etch_transaction", where?.etch_transaction),
    IncludeAddress(models, "deployer_address", where?.deployer_address),
  ],
  attributes: {
    exclude: ["deployer_address_id", "etch_transaction_id", "id"],
  },
});

const IncludeTransaction = (models, as, where) => ({
  model: models.Transaction,
  as: as ?? "transaction",
  where: where ?? null,
  attributes: ["hash"],
});

const IncludeAddress = (models, as, where) => ({
  model: models.Address,
  as: as ?? "address",
  where: where ?? null,
  attributes: ["address"],
});

const IncludeUtxo = (models, as, where) => ({
  model: models.Utxo,
  as: as ?? "utxo",
  where: stripFields(where, ["transaction", "transaction_spent", "address"]),
  include: [
    IncludeTransaction(models, "transaction", where?.transaction),
    IncludeTransaction(models, "transaction_spent", where?.transaction_spent),
    IncludeAddress(models, null, where?.address),
  ],
  attributes: {
    exclude: ["address_id", "transaction_id", "transaction_spent_id", "id"],
  },
});

const getSomeAddressBalance = (models, where) => {
  return {
    model: models.Balance,
    where: stripFields(where, ["address", "rune"]),
    include: [
      IncludeAddress(models, null, where?.address ?? null),
      IncludeRune(models, null, where?.rune ?? null),
    ],
    attributes: {
      exclude: ["address_id", "rune_id", "id"],
    },
  };
};

const getSomeUtxoBalance = (models, where) => {
  return {
    model: models.Utxo_balance,
    where: stripFields(where, ["utxo", "rune"]),
    include: [
      IncludeUtxo(models, null, where?.utxo ?? null),
      IncludeRune(models, null, where?.rune ?? null),
    ],

    attributes: {
      exclude: ["utxo_id", "rune_id", "id"],
    },
  };
};

module.exports = {
  getSomeAddressBalance,
  getSomeUtxoBalance,
};

/*
const getUtxo = (hash, vout, models) => {
  const { Rune, Address, Utxo, Transaction } = models;

  return {
    include: [
      {
        model: Utxo,
        as: "utxo",
        where: {
          vout_index: vout,
        },
        include: [
          {
            model: Transaction,
            as: "transaction",
            raw: true,
            attributes: ["hash"],
            where: {
              hash,
            },
          },
          {
            model: Transaction,
            as: "transaction_spent",
            attributes: ["hash"],
          },
          {
            model: Address,
            as: "address",
            attributes: ["address"],
          },
        ],
        attributes: {
          exclude: [
            "address_id",
            "transaction_id",
            "transaction_spent_id",
            "id",
          ],
        },
      },
      {
        model: Rune,
        as: "rune",
        include: [
          {
            model: Transaction,
            as: "etch_transaction",
            attributes: ["hash"],
          },
          {
            model: Address,
            as: "deployer_address",
            attributes: ["address"],
          },
        ],
        attributes: {
          exclude: ["deployer_address_id", "etch_transaction_id", "id"],
        },
      },
    ],

    attributes: {
      exclude: ["utxo_id", "rune_id", "id"],
    },
  };
};
*/
