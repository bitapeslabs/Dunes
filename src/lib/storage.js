const { databaseConnection } = require("../database/createConnection");
const { Op } = require("sequelize");

const storage = async () => {
  // This object is mapped to the most common primary key queries for O(1) access
  let local = {
      // Indexed by "address"
      Account: {},
      // Indexed by "address"
      Balance: {},
      // Indexed by "rune_protocol_id"
      Rune: {},
      // Indexed by "hash"
      Transaction: {},
      // Indexed by "txid:vout"
      Utxo: {},
    },
    db;

  const localPrimaryKeys = {
    Account: "address",
    Balance: "address",
    Rune: "rune_protocol_id",
    Transaction: "hash",
    Utxo: "hash",
  };

  const _init = async () => {
    try {
      db = await databaseConnection();

      // Populate counts on memory to create an ID pk for each item
      await Promise.all(
        Object.keys(local).map(async (key) => {
          let count = await db[key].count();
          local[key].count = count;
        })
      );
    } catch (error) {
      console.error(
        "(storage) Failed to initialize database connection:",
        error
      );
      throw error;
    }
  };

  const updateAttribute = async (modelName, key, attribute, value) => {
    const { [modelName]: LocalModel } = local;
    let primary = localPrimaryKeys[modelName];

    if (LocalModel[key]) {
      LocalModel[key][attribute] = value;
      return;
    }

    try {
      let liveModel = await findOne(modelName, key);
      LocalModel[liveModel[primary]] = { ...liveModel, [attribute]: value };

      return LocalModel[liveModel[primary]];
    } catch (error) {
      console.error(`(storage) Failed to update ${modelName}:`, error);
      throw error;
    }
  };

  const findOneWithAttribute = async (modelName, attribute, value) => {
    const { [modelName]: Model } = db;
    const { [modelName]: LocalModel } = local;

    let model = Object.values(LocalModel).find(
      (model) => model[attribute] === value
    );

    if (model) return model;

    try {
      model = await Model.findOne({ where: { [attribute]: value } });
      return model;
    } catch (error) {
      console.error(`(storage) Failed to retrieve ${modelName}:`, error);
      throw error;
    }
  };

  const findOne = async (modelName, key) => {
    const { [modelName]: Model } = db;
    const { [modelName]: LocalModel } = local;

    if (LocalModel[key]) {
      return LocalModel[key];
    }

    try {
      let row = await Model.findOne({
        where: { [localPrimaryKeys[modelName]]: key },
      });
      return row;
    } catch (error) {
      console.error(`(storage) Failed to retrieve ${modelName}:`, error);
      throw error;
    }
  };

  const findManyInFilter = async (modelName, filterArr) => {
    const { [modelName]: Model } = db;
    const { [modelName]: LocalModel } = local;
    let primary = localPrimaryKeys[modelName];

    const localRows = filterArr
      .filter((key) => LocalModel[key])
      .map((key) => LocalModel[key]);

    const nonLocalFilter = filterArr.filter((key) => !LocalModel[key]);

    if (!nonLocalFilter.length) return localRows;

    try {
      const nonLocalRows = await Model.findAll({
        where: { [primary]: { [Op.in]: nonLocalFilter } },
      });
      return localRows.concat(nonLocalRows);
    } catch (error) {
      console.error(`(storage) Failed to retrieve ${modelName}:`, error);
      throw error;
    }
  };

  const create = (modelName, data) => {
    const { [modelName]: LocalModel } = local;
    let primary = localPrimaryKeys[modelName];

    LocalModel.count = (LocalModel.count || 0) + 1;

    LocalModel[data[primary]] = {
      id: LocalModel.count,
      ...data,
    };

    return LocalModel[data[primary]];
  };

  const findOrCreate = async (modelName, key, defaults) => {
    const { [modelName]: LocalModel } = local;

    let model = await findOne(modelName, key);
    if (model) return model;

    create(modelName, defaults);

    return LocalModel[key];
  };

  await _init();

  return {
    local,
    db,
    updateAttribute,
    findManyInFilter,
    findOneWithAttribute,
    findOne,
    findOrCreate,
    create,
  };
};

module.exports = {
  storage,
};
