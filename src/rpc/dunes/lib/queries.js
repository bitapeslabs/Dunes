const { Op, Sequelize } = require("sequelize");
const { stripFields } = require("../../../lib/utils");

const IncludeDune = (models, as, where) => ({
  model: models.Dune,
  as: as ?? "dune",
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
    where: stripFields(where, ["address", "dune"]),
    include: [
      IncludeAddress(models, null, where?.address ?? null),
      IncludeDune(models, null, where?.dune ?? null),
    ],
    attributes: {
      exclude: ["address_id", "dune_id", "id"],
    },
  };
};

const getSomeUtxoBalance = (models, where) => {
  return {
    model: models.Utxo_balance,
    where: stripFields(where, ["utxo", "dune"]),
    include: [
      IncludeUtxo(models, null, where?.utxo ?? null),
      IncludeDune(models, null, where?.dune ?? null),
    ],

    attributes: {
      exclude: ["utxo_id", "dune_id", "id"],
    },
  };
};

module.exports = {
  getSomeAddressBalance,
  getSomeUtxoBalance,
};

/*
const getUtxo = (hash, vout, models) => {
  const { Dune, Address, Utxo, Transaction } = models;

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
        model: Dune,
        as: "dune",
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
      exclude: ["utxo_id", "dune_id", "id"],
    },
  };
};
*/
