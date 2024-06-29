const { databaseConnection } = require("../database/createConnection");
const { Op } = require("sequelize");
const { pluralize, removeItemsWithDuplicateProp } = require("./tools");
const mariadb = require("mariadb");

const storage = async () => {
  //Configurations

  const LOCAL_PRIMARY_KEYS = {
    Account: "address",
    Balance: "id",
    Rune: "rune_protocol_id",
    Transaction: "hash",
    Utxo: "id",
  };

  const _genDefaultCache = () =>
    Object.keys(LOCAL_PRIMARY_KEYS).reduce((acc, key) => {
      acc[key] = {};
      return acc;
    }, {});

  // This object is mapped to the most common primary key queries for O(1) access. See LOCAL_PRIMARY_KEYS
  let local = _genDefaultCache(),
    db,
    rawConnection;

  let cachedAutoIncrements = {};

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

  const updateAttribute = async (
    modelName,
    primary,
    attribute,
    value,
    /*
      Optional, uses the template to create a row rather than fetching from db. 
      Useful if we are updating many rows we already have stored in memory somewhere else
    */
    template
  ) => {
    const { [modelName]: LocalModel } = local;

    let primaryKey = LOCAL_PRIMARY_KEYS[modelName];

    if (LocalModel[primary]) {
      LocalModel[primary][attribute] = value;
      return;
    }

    let liveModel = template ?? (await findOne(modelName, primary));
    let newPrimary = liveModel[primaryKey];

    LocalModel[newPrimary] = { ...liveModel, [attribute]: value };

    return LocalModel[newPrimary];
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
      console.error(
        `(storage) Failed to retrieve ${modelName} in findOne:`,
        error
      );
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

    const primary = LOCAL_PRIMARY_KEYS[modelName];

    const isObject = (obj) =>
      obj !== null && typeof obj === "object" && !Array.isArray(obj);

    const getFilterType = (filterItem) => {
      if (Array.isArray(filterItem)) return "array";

      if (typeof filterItem === "string") return "string";

      if (isObject(filterItem)) return "object";

      throw new Error("(storage) Unknown filter type");
    };

    const testWithAttributeFilter = (row, attributeFilter) => {
      /*
        An attribute array can contain any nested number of items like this
        {"id", "rune_protocol_id"}
        [{"id", "rune_protocol_id"}, ...]
        [{"id", "rune_protocol_id}], ["id", "rune_protocol_id"]]
        
        every array in the attribute array should always have exactly 2 items, the value and the attribute

        an attribute can also be a string. When only string is provided the fallback is the primary key of the model. if no
        primary is provided "id" is used as default primary
      */

      //Check if last leaf and string

      const filterType = getFilterType(attributeFilter);

      if (filterType === "string") return row[primary] === attributeFilter;

      //Check if last leaf and object
      if (filterType === "object") {
        if (Object.keys(attributeFilter).length !== 1)
          throw new Error(
            "(storage) An object in the attribute array must have exactly one key"
          );

        const [attribute, value] = Object.entries(attributeFilter).flat();

        return row[attribute] === value;
      }

      //Test leaves if branch (array)
      return attributeFilter.every((leaf) =>
        testWithAttributeFilter(row, leaf)
      );
    };

    //Get local rows and generate a filter array with the rows not found in local cache.
    const localRows = Object.values(LocalModel).reduce((acc, row) => {
      for (let attributeFilter of filterArr) {
        if (testWithAttributeFilter(row, attributeFilter)) {
          acc.push(row);
          return acc;
        }
      }
      return acc;
    }, []);

    /*
      Now we must test the db with the same filter array
    */
    let sequelizeFilter = filterArr

      //Transform filter to be used in sequelize
      .reduce((acc, filterItem) => {
        let type = getFilterType(filterItem);

        const getAttributesAndPush = (array, filterItem) => {
          let type = getFilterType(filterItem);

          const [attribute, value] =
            type === "string"
              ? [LOCAL_PRIMARY_KEYS[modelName], filterItem]
              : Object.entries(filterItem).flat();

          return [...array, { [attribute]: value }];
        };

        if (type !== "array") return getAttributesAndPush(acc, filterItem);

        //The hierarchy of Ands dont matter because the end rsult requires all of them to be true, so we can flatten recursively for simplicity
        const flatAttributes = filterItem.flat(Infinity);
        //Here we add every attribute we want in the specific Op.and filter (any item in the array)
        const andOperations = flatAttributes.reduce(
          (acc, filterItem) => getAttributesAndPush(acc, filterItem),
          []
        );

        //We add a new Op.and to the final sequelize array
        acc.push({ [Op.and]: andOperations });

        return acc;
      }, []);

    try {
      const nonLocalRows = await Model.findAll({
        raw: true,
        where: { [Op.or]: sequelizeFilter },
      });

      //Because of the checks made above there will never be duplicates
      return removeItemsWithDuplicateProp(localRows.concat(nonLocalRows), "id");
    } catch (error) {
      console.error(
        `(storage) Failed to retrieve ${modelName} in findManyInFilter:`,
        error
      );
      throw error;
    }
  };

  const create = (modelName, data) => {
    const { [modelName]: LocalModel } = local;

    let primaryKey = LOCAL_PRIMARY_KEYS[modelName];

    //Simulate the auto increment functionality on cache
    cachedAutoIncrements[modelName] =
      (cachedAutoIncrements[modelName] || 0) + 1;

    data = {
      id: cachedAutoIncrements[modelName],
      ...data,
    };

    //Add the model with the ID that would be generated in the database to cache
    LocalModel[data[primaryKey]] = data;

    //Return the model created
    return data;
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
        console.log(`(storage) Committing ${modelName}...`);
        rows = Object.values(rows);

        for (let rowIndex in rows) {
          let row = rows[rowIndex];
          console.log(`(storage) Committing ${modelName} row ${rowIndex}...`);
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
    local = _genDefaultCache();
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
