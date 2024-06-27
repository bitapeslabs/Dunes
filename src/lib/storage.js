const { databaseConnection } = require("../database/createConnection");
const { Op } = require("sequelize");
const { pluralize } = require("./tools");
const mariadb = require("mariadb");

const storage = async () => {
  //Configurations

  const LOCAL_PRIMARY_KEYS = {
    Account: "address",
    Balance: "address",
    Rune: "rune_protocol_id",
    Transaction: "hash",
    Utxo: "hash",
  };

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
    db,
    rawConnection;

  const cachedAutoIncrements = {};

  const _getAutoIncrement = async (tableName) => {
    //Sequelize be default uses singular nouns, so the Cache library does also. Names need to be pluralized before querying the database.
    const pluralizedTableName = pluralize(tableName.toLowerCase());
    try {
      const results = await rawConnection.query(
        `SELECT AUTO_INCREMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${process.env.DB_NAME}' AND TABLE_NAME = '${pluralizedTableName}'`
      );
      return parseInt(results[0].AUTO_INCREMENT ?? 0n) - 1;
    } catch (error) {
      console.error(
        `(storage) Failed to retrieve auto increment for ${tableName}:`,
        error
      );
      return 0;
    }
  };

  const _init = async () => {
    try {
      db = await databaseConnection();

      rawConnection = await mariadb.createConnection({
        host: process.env.DB_HOST || "localhost",
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
      });

      // Populate counts on memory to create an ID pk for each item
      await Promise.all(
        Object.keys(local).map(async (tableName) => {
          cachedAutoIncrements[tableName] = await _getAutoIncrement(tableName);
        })
      );
      await rawConnection.end();
    } catch (error) {
      console.error(
        "(storage) Failed to initialize database connection:",
        error
      );
      throw error;
    }
  };

  const updateAttribute = async (modelName, primary, attribute, value) => {
    const { [modelName]: LocalModel } = local;

    let primaryKey = LOCAL_PRIMARY_KEYS[modelName];

    if (LocalModel[primary]) {
      LocalModel[primary][attribute] = value;
      return;
    }

    try {
      let liveModel = await findOne(modelName, primary);
      let newPrimary = liveModel[primaryKey];

      LocalModel[newPrimary] = { ...liveModel, [attribute]: value };

      return LocalModel[newPrimary];
    } catch (error) {
      console.error(`(storage) Failed to update ${modelName}:`, error);
      throw error;
    }
  };

  const findOne = async (modelName, value, attribute) => {
    const { [modelName]: Model } = db;
    const { [modelName]: LocalModel } = local;

    if (LocalModel[value] && !attribute) {
      return LocalModel[value];
    } else {
      let row = Object.values(LocalModel).find(
        (row) => row[attribute] === value
      );

      if (row) return row;
    }

    try {
      let row = await Model.findOne({
        where: { [attribute ?? LOCAL_PRIMARY_KEYS[modelName]]: value },
      });
      return row;
    } catch (error) {
      console.error(`(storage) Failed to retrieve ${modelName}:`, error);
      throw error;
    }
  };

  const findManyInFilter = async (modelName, filterArr) => {
    /*
      There are two types of attributes "primary" and "custom". A primary attribute is searched for 
      if an item in filter array is a string, then the function assumes you are searching for an
      item whose primary key value is the string. If an array is passed, the first item is the value
      and the second item is the attribute to search for.
    */

    const { [modelName]: Model } = db;
    const { [modelName]: LocalModel } = local;

    if (!filterArr.length) return [];

    const getValueAndAttribute = (filterItem) => {
      const hasTypeAttribute = Array.isArray(filterItem);
      //If an empty string is passed, the attribute will be defaulted to primary
      //if an array is passed, item one is value and item 2 is attribute

      //defaults to "filterItem"
      let value = (hasTypeAttribute ? filterItem[0] : filterItem) ?? filterItem;

      //defaults to primary key
      let attribute =
        (hasTypeAttribute ? filterItem[1] : LOCAL_PRIMARY_KEYS[modelName]) ??
        LOCAL_PRIMARY_KEYS[modelName];

      return [value, attribute];
    };

    const processFilter = (filterItem) => {
      const hasTypeAttribute = Array.isArray(filterItem);
      const [value, attribute] = getValueAndAttribute(filterItem);

      let rowFound = !hasTypeAttribute
        ? LocalModel[value]
        : Object.values(LocalModel).find((row) => row[attribute] === value);

      return rowFound;
    };

    //Get local rows and generate a filter array with the rows not found in local cache.
    const { localRows, nonLocalFilterArr } = filterArr.reduce(
      (acc, filterItem) => {
        const rowFound = processFilter(filterItem);

        acc[rowFound ? "localRows" : "nonLocalFilterArr"].push(
          rowFound ?? filterItem
        );

        return acc;
      },
      { localRows: [], nonLocalFilterArr: [] }
    );

    //If local cache fulfilled all the filter, return it
    if (!nonLocalFilterArr.length) return localRows;

    /*
      If any items were not found in the local cache, we need to search for it in db. The way we do this is by
      creating a sequelize filter with the nonLocalFilter objects and then querying the db with it.
    */
    let sequelizeFilter = nonLocalFilterArr

      //Transform filter to be used in sequelize
      .reduce((acc, filterItem) => {
        const [value, attribute] = getValueAndAttribute(filterItem);

        acc[attribute] = acc[attribute] ?? { [Op.in]: [] };
        acc[attribute][Op.in].push(value);

        return acc;
      }, {});

    //Create an Op.or filter with the sequelize filter
    sequelizeFilter = Object.entries(sequelizeFilter).reduce((acc, entry) => {
      const [key, value] = entry;

      acc.push({ [key]: value });
      return acc;
    }, []);

    try {
      const nonLocalRows = await Model.findAll({
        where: { [Op.or]: sequelizeFilter },
      });

      //Because of the checks made above there will never be duplicates
      return localRows.concat(nonLocalRows);
    } catch (error) {
      console.error(`(storage) Failed to retrieve ${modelName}:`, error);
      throw error;
    }
  };

  const create = (modelName, data) => {
    const { [modelName]: LocalModel } = local;

    let primaryKey = LOCAL_PRIMARY_KEYS[modelName];

    //Simulate the auto increment functionality on cache
    cachedAutoIncrements[modelName] =
      (cachedAutoIncrements[modelName] || 0) + 1;

    //Add the model with the ID that would be generated in the database to cache
    LocalModel[data[primaryKey]] = {
      id: cachedAutoIncrements[modelName],
      ...data,
    };

    //Return the model created
    return LocalModel[data[primaryKey]];
  };

  const findOrCreate = async (modelName, key, defaults) => {
    const { [modelName]: LocalModel } = local;

    let model = await findOne(modelName, key);
    if (model) return model;

    create(modelName, defaults);

    return LocalModel[key];
  };

  const commitChanges = async () => {
    const transaction = await db.sequelize.transaction();

    try {
      let modelEntries = Object.entries(local);

      for (let modelEntry of modelEntries) {
        let [modelName, rows] = modelEntry;

        rows = Object.values(rows);

        for (let row of rows) {
          try {
            await db[modelName].upsert(row, { transaction });
          } catch (error) {
            console.error(`(storage) Failed to commit ${modelName}:`, error);
            throw error;
          }
        }
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      console.error("(storage) Transaction failed and rolled back:", error);
      throw error;
    }

    //Reset all local cache after commit
    local = Object.keys(local).reduce((acc, modelName) => {
      acc[modelName] = {};
      return acc;
    }, {});
  };

  await _init();

  return {
    local,
    db,
    updateAttribute,
    findManyInFilter,
    findOne,
    findOrCreate,
    create,
    commitChanges,
  };
};

module.exports = {
  storage,
};
