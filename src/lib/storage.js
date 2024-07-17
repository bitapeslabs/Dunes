const { databaseConnection } = require("../database/createConnection");
const { Op } = require("sequelize");
const { pluralize, removeItemsWithDuplicateProp, log } = require("./utils");
const { Client } = require("pg");

const storage = async (useSync) => {
  //Configurations

  const LOCAL_PRIMARY_KEYS = {
    Balance: "id",
    Rune: "rune_protocol_id",
    Utxo: "id",
  };

  // This object is mapped to the most common primary key queries for O(1) access. See LOCAL_PRIMARY_KEYS
  let local = {},
    db;

  const _genDefaultCache = () =>
    Object.keys(LOCAL_PRIMARY_KEYS).forEach((key) => {
      local[key] = {};
    });

  _genDefaultCache();

  let cachedAutoIncrements = {};

  const _getAutoIncrement = async (tableName) => {
    //Sequelize be default uses singular nouns, so the Cache library does also. Names need to be pluralized before querying the database.
    const pluralizedTableName = pluralize(tableName.toLowerCase());
    try {
      const results = await db.sequelize.query(
        `SELECT nextval('${pluralizedTableName}_id_seq'::regclass)`
      );

      //The nextval function changes the value of the sequence, something that would be done by sequelize on creating a new document. We must set it back by one so we can
      //simulate incrementing it by one in the cache when we create a new row
      return parseInt(results[0][0].nextval ?? 0n) - 1;
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

      //useSync constructs the database from the models we have in /database/models
      if (useSync) await db.sequelize.sync({ force: true });

      // Populate counts on memory to create an ID pk for each item
      await Promise.all(
        Object.keys(local).map(async (tableName) => {
          cachedAutoIncrements[tableName] = await _getAutoIncrement(tableName);
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

  const loadManyIntoMemory = async (modelName, sequelizeQuery) => {
    /*
        A lot of the queries done to the database during block processing are unecessary and repetitive. By having
        everything we know we will need for a block in memory, we can speed up the speed at which we load a block by
        magnitudes of order. We can use sqls "IN" operator for this. documents's fetched from inMemory
        have a flag indicating that its just a read copy. 

        __memory: true
        
        This is to prevent unecessary upserts. 
        
        Once any attribute is changed from this document, the __memory field is deleted as the upset will be needed
    */

    const { [modelName]: LocalModel } = local;
    const { [modelName]: Model } = db;

    try {
      const foundRows = await Model.findAll({
        raw: true,
        where: sequelizeQuery,
      });

      const primaryKey = LOCAL_PRIMARY_KEYS[modelName];

      foundRows.forEach((row) => {
        LocalModel[row[primaryKey]] = { ...row, __memory: true };
      });

            
      log(modelName + " (fr): " + foundRows.length, 'debug');
      log(modelName + " (lo): " + Object.keys(local[modelName]).length, 'debug');
      return foundRows;
    } catch (error) {
      console.error(
        `(storage) Failed to retrieve ${modelName} in findOne:`,
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

    if (LocalModel[primary]) {
      LocalModel[primary][attribute] = value;

      //We have altered the document and therefore we should upsert when we commit changes
      delete LocalModel[primary].__memory;

      return LocalModel[primary];
    }

    let primaryKey = LOCAL_PRIMARY_KEYS[modelName];

    //This should be fine in local cache because we will only ever update a row already fetched from the database or created in the block
    let liveModel = template ?? (await findOne(modelName, primary));
    let newPrimary = liveModel[primaryKey];

    LocalModel[newPrimary] = { ...liveModel, [attribute]: value };

    return LocalModel[newPrimary];
  };

  const findOne = async (
    modelName,
    value,
    attribute,
    ignoreDatabase = false
  ) => {
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

    if (ignoreDatabase) return null;

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

  const findManyInFilter = async (
    modelName,
    filterArr,
    ignoreDatabase = false
  ) => {
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
        We would want to avoid querying the DB if we already have the copy of the document in __memory
        This should only ever be used if we have already cloned documents into storage from the db. Otherwise
        syncing issues will pop up because local and database are not synced.
    */
    if (ignoreDatabase) return localRows;

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
        log(`Committing ${modelName}...`, "stat");
        rows = Object.values(rows);

        for (let rowIndex in rows) {
          let row = rows[rowIndex];
          if (row.__memory) {
            continue;
          }
          try {
            await db[modelName].upsert(row, { transaction });
          } catch (error) {
            log(`Failed to commit ${modelName}: ` + error, "panic");
            throw error;
          }
        }
        const pluralizedTableName = pluralize(modelName.toLowerCase());

        await db.sequelize.query(
          `SELECT setval('${pluralizedTableName}_id_seq', ${cachedAutoIncrements[modelName]}, true)`
        );
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      log(`An error ocurred while comitting to db: ` + error, "panic");

      throw error;
    }

    //Reset all local cache after commit
    _genDefaultCache();

    return;
  };

  await _init();
  console.log(cachedAutoIncrements);
  return {
    local,
    db,
    updateAttribute,
    findManyInFilter,
    findOne,
    findOrCreate,
    create,
    commitChanges,
    loadManyIntoMemory,
  };
};

module.exports = {
  storage,
};
