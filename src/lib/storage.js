const { databaseConnection } = require("../database/createConnection");
const { Op } = require("sequelize");
const { pluralize, removeItemsWithDuplicateProp, log } = require("./utils");
const { Client } = require("pg");
const storage = async (useSync) => {
  //Configurations

  //These are passed as an array and will instruct the storage to create a hashmap of the rows

  const LOCAL_PRIMARY_KEYS = {
    Balance: "balance_index",
    Rune: "rune_protocol_id",
    Utxo: "utxo_index",
    Event: "id",
  };

  //These are hashmaps that point back an object in local. This is used to quickly find a row in O(1) time even if the primary key is not the id
  const REFERENCE_FIELDS = {
    Rune: ["raw_name"],
  };

  // This object is mapped to the most common primary key queries for O(1) access. See LOCAL_PRIMARY_KEYS
  let local = {},
    references = {},
    db;

  const _genDefaultCache = () => {
    Object.keys(LOCAL_PRIMARY_KEYS).forEach((key) => {
      local[key] = {};
    });

    Object.keys(REFERENCE_FIELDS).forEach((key) => {
      references[key] = REFERENCE_FIELDS[key].reduce((acc, field) => {
        acc[field] = {};
        return acc;
      }, {});
    });
  };

  _genDefaultCache();
  let cachedAutoIncrements = {};

  const _getAutoIncrement = async (tableName) => {
    //Sequelize be default uses singular nouns, so the Cache library does also. Names need to be pluralized before querying the database.
    const pluralizedTableName = pluralize(tableName.toLowerCase());
    try {
      //Check value and rollback transaction to prevent change
      const transaction = await db.sequelize.transaction();

      const results = await db.sequelize.query(
        `SELECT nextval('${pluralizedTableName}_id_seq'::regclass)`,
        { transaction }
      );
      await transaction.rollback();

      //The nextval function changes the value of the sequence, something that would be done by sequelize on creating a new document. We must set it back by one so we can
      //simulate incrementing it by one in the cache when we create a new row
      return parseInt(results[0][0].nextval ?? 1) - 1;
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

  const __updateReferences = (modelName, rowRef) => {
    const { [modelName]: RefModel } = references;

    if (!RefModel) {
      return;
    }

    REFERENCE_FIELDS[modelName].forEach((field) => {
      //Create reference in memory
      if (!RefModel[field]) {
        return;
      }
      references[modelName][field][rowRef[field]] = rowRef;
    });
  };

  const __findWithPrimaryOrReference = (modelName, value) => {
    const { [modelName]: LocalModel } = local;
    const { [modelName]: RefModel } = references;

    if (LocalModel[value]) return LocalModel[value];

    //That model has no references
    if (!RefModel) return;

    return Object.values(RefModel).find((ref) => ref[value]);
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

        __updateReferences(modelName, LocalModel[row[primaryKey]]);
      });

      log(modelName + " (fr): " + foundRows.length, "debug");
      log(
        modelName + " (lo): " + Object.keys(local[modelName]).length,
        "debug"
      );
      return foundRows;
    } catch (error) {
      console.error(
        `(storage) Failed to retrieve ${modelName} in findOne:`,
        error
      );
      throw error;
    }
  };

  const updateAttribute = (modelName, primary, attribute, value) => {
    const { [modelName]: LocalModel } = local;

    let mappedObject = __findWithPrimaryOrReference(modelName, primary);

    if (mappedObject) {
      mappedObject[attribute] = value;

      //We have altered the document and therefore we should upsert when we commit changes
      delete mappedObject.__memory;

      return mappedObject;
    }

    //findOne could potentially be a Promise, so we have to await it as we are not ignoring database
    return new Promise(async function (resolve, reject) {
      let liveModel = await findOne(modelName, primary);

      LocalModel[primary] = { ...liveModel, [attribute]: value };
      __updateReferences(modelName, LocalModel[primary]);
      resolve(LocalModel[primary]);
    });
  };

  //Immediately resolves if no fetch to DB
  const findOne = (modelName, value, attribute, ignoreDatabase = false) => {
    const { [modelName]: Model } = db;
    const { [modelName]: LocalModel } = local;

    let mappedObject = __findWithPrimaryOrReference(modelName, value);

    if (mappedObject && !attribute) {
      return mappedObject;
    } else {
      let row = Object.values(LocalModel).find(
        (row) => row[attribute] === value
      );

      if (row) return row;
    }

    if (ignoreDatabase) return null;

    //If a db lookup is required, a promise is returned instead
    return new Promise(async function (resolve, reject) {
      try {
        let row = await Model.findOne({
          where: { [attribute ?? LOCAL_PRIMARY_KEYS[modelName]]: value },
        });
        resolve(row);
      } catch (error) {
        console.error(
          `(storage) Failed to retrieve ${modelName} in findOne:`,
          error
        );
        throw error;
      }
    });
  };

  const findManyInFilter = (modelName, filterArr, ignoreDatabase = false) => {
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

      //Results in O[1]
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

    const isStaticFilter = filterArr.every(
      (filterItem) => getFilterType(filterItem) === "string"
    );
    //If all operations in the filter are string, its an OR filled with primaries. We can optimize then.

    //Get local rows and generate a filter array with the rows not found in local cache.
    const localRows = isStaticFilter
      ? //Return all instances where the primary key exists in the array (much faster!)
        filterArr
          .map((key) => __findWithPrimaryOrReference(modelName, key))
          .filter(Boolean)
      : Object.values(LocalModel).reduce((acc, row) => {
          //This is effectively an OR operation. The upmost filter arr is used as an OR, inner arrs are used as ANDS
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
    return new Promise(async function (resolve, reject) {
      try {
        const nonLocalRows = await Model.findAll({
          raw: true,
          where: { [Op.or]: sequelizeFilter },
        });

        //Because of the checks made above there will never be duplicates
        resolve(
          removeItemsWithDuplicateProp(localRows.concat(nonLocalRows), "id")
        );
      } catch (error) {
        log(
          `(storage) Failed to retrieve ${modelName} in findManyInFilter:` +
            error,
          "panic"
        );
        throw error;
      }
    });
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

    //The model created needs to be added to the references (on updates we dont need to do this as the reference to the object will stay the same)
    __updateReferences(modelName, LocalModel[data[primaryKey]]);

    //Return the model created
    return data;
  };

  const findOrCreate = async (
    modelName,
    key,
    ignoreDatabase = true,
    defaults
  ) => {
    const { [modelName]: LocalModel } = local;
    let model = await findOne(modelName, key, false, ignoreDatabase);
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
        log(
          `Committing ${modelName} with ${rows.length} rows to db...`,
          "debug"
        );
        rows = Object.values(rows).filter((row) => !row.__memory);

        if (0 > rows.length) continue;

        await db[modelName].bulkCreate(rows, {
          transaction,
          updateOnDuplicate: Object.keys(db[modelName].rawAttributes).filter(
            //we want to preserve the createdAt field on update
            (field) => field !== "createdAt"
          ),
        });

        const pluralizedTableName = pluralize(modelName.toLowerCase());

        //Check for 0 value because "id" range is (1..2147483647) on Postgres
        if (cachedAutoIncrements[modelName] > 0) {
          await db.sequelize.query(
            `SELECT setval('${pluralizedTableName}_id_seq', ${cachedAutoIncrements[modelName]}, true)`
          );
        }
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
  return {
    references,
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
