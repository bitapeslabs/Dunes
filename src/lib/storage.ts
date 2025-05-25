import { databaseConnection } from "../database/createConnection";
import {
  Op,
  QueryTypes,
  Transaction as SequelizeTx,
  ModelStatic,
} from "sequelize";
import {
  pluralize,
  removeItemsWithDuplicateProp,
  log,
  chunkify,
} from "./utils";
import type { Client } from "pg"; // kept for parity; it’s unused

export function isPromise<T>(obj: T | Promise<T>): obj is Promise<T> {
  return typeof (obj as Promise<T>).then === "function";
}

type SpecifiedModels = keyof typeof LOCAL_PRIMARY_KEYS;

/* ── primitive helpers ────────────────────────────────────────────────────── */

type IndexKey = string | number; // keys allowed for maps

type Scalar = string | number | boolean | null | undefined | bigint; //
export type ModelRow = Record<string, Scalar>; // plain row from Sequelize

type LocalCache = Record<string, Record<IndexKey, ModelRow>>;
type ReferenceCache = Record<
  string,
  Record<string, Record<IndexKey, ModelRow>>
>;
type GroupCache = Record<string, Record<string, Record<IndexKey, ModelRow[]>>>;

/* ── static configuration (unchanged) ─────────────────────────────────────── */

const BUILD_FIELDS = {
  Utxo: { utxo_index: ["transaction_id", "vout_index"] },
  Balance: { balance_index: ["address_id", "mezcal_id"] },
} as const;

const BUILD_GROUPS = {
  Utxo_balance: ["utxo_id"],
  Utxo: ["transaction_id"],
} as const;

const LOCAL_PRIMARY_KEYS = {
  Address: "address",
  Transaction: "hash",
  Mezcal: "mezcal_protocol_id",
  Balance: "balance_index",
  Utxo: "utxo_index",
  Utxo_balance: "id",
  Event: "id",
} as const;

const REFERENCE_FIELDS = {
  Mezcal: ["name", "id"],
  Address: ["id"],
  Transaction: ["id"],
} as const;

export async function storage(useSync = false) {
  /* in‑memory */
  const local: LocalCache = {};
  const references: ReferenceCache = {};
  const groups: GroupCache = {};

  let db!: Awaited<ReturnType<typeof databaseConnection>>;

  const cachedAutoIncrements: Record<string, number> = {};

  const genDefaultCache = (): void => {
    Object.keys(LOCAL_PRIMARY_KEYS).forEach((k) => (local[k] = {}));
    Object.entries(REFERENCE_FIELDS).forEach(([m, flds]) => {
      references[m] = flds.reduce(
        (acc, f) => ({ ...acc, [f]: {} }),
        {} as Record<string, Record<IndexKey, ModelRow>>
      );
    });
    Object.entries(BUILD_GROUPS).forEach(([m, flds]) => {
      groups[m] = flds.reduce(
        (acc, f) => ({ ...acc, [f]: {} }),
        {} as Record<string, Record<IndexKey, ModelRow[]>>
      );
    });
  };
  genDefaultCache();

  const getAutoIncrement = async (table: string): Promise<number> => {
    const plural = pluralize(table.toLowerCase());

    // SELECT nextval but don’t advance sequence permanently
    const trx = await db.sequelize.transaction();
    const res = await db.sequelize.query<{ nextval: string }>(
      `SELECT nextval('${plural}_id_seq'::regclass)`,
      { type: QueryTypes.SELECT, transaction: trx as SequelizeTx }
    );
    await trx.rollback();

    return (res[0]?.nextval ? parseInt(res[0].nextval, 10) : 1) - 1;
  };

  const addRowToGroups = (model: SpecifiedModels, row: ModelRow) => {
    const cfg = BUILD_GROUPS[model as keyof typeof BUILD_GROUPS];
    if (!cfg) return;
    cfg.forEach((field) => {
      const key: IndexKey = String(row[field]);
      const bucket = groups[model][field];
      (bucket[key] ??= []).push(row);
    });
  };

  const updateReferences = (model: SpecifiedModels, row: ModelRow) => {
    const rf = REFERENCE_FIELDS[model as keyof typeof REFERENCE_FIELDS];
    if (!rf) return;
    rf.forEach((f) => {
      references[model][f][String(row[f])] = row;
    });
  };

  const buildIndexes = (row: ModelRow, model: SpecifiedModels): ModelRow => {
    const cfg = BUILD_FIELDS[model as keyof typeof BUILD_FIELDS];
    if (!cfg) return row;
    Object.entries(cfg).forEach(([flag, comps]) => {
      row[flag] = comps.map((c: string) => row[c]).join(":");
    });
    return row;
  };

  const findWithPrimaryOrReference = <T extends ModelRow>(
    model: string,
    key: string
  ): T | null => {
    if (local[model][key]) return local[model][key] as T;
    const [value, field] = key.split("@REF@");
    if (!field) return null;

    return (references[model]?.[field]?.[value] as T) ?? null;
  };

  const init = async () => {
    db = await databaseConnection();
    if (useSync) await db.sequelize.sync({ force: true });

    await Promise.all(
      Object.keys(LOCAL_PRIMARY_KEYS).map(
        async (tbl) => (cachedAutoIncrements[tbl] = await getAutoIncrement(tbl))
      )
    );
  };

  const loadManyIntoMemory = async (
    model: SpecifiedModels,
    where: Record<string, unknown>
  ): Promise<ModelRow[]> => {
    const Model: ModelStatic<any> = (db as any)[model];
    //console.log("Loading into memory", model, where);
    const rows = (await Model.findAll({ where })).map((row) =>
      row.toJSON()
    ) as ModelRow[];

    const pk = LOCAL_PRIMARY_KEYS[model as keyof typeof LOCAL_PRIMARY_KEYS];
    rows.forEach((raw) => {
      const row = buildIndexes({ ...raw, __memory: true }, model);
      if (!local[model][row[pk] as IndexKey]) {
        local[model][row[pk] as IndexKey] = row;
        updateReferences(model, row);
        addRowToGroups(model, row);
      }
    });
    return rows;
  };

  const updateAttribute = (
    model: SpecifiedModels,
    key: IndexKey,
    attr: string,
    val: Scalar
  ): ModelRow | null => {
    const row = findWithPrimaryOrReference(model, String(key));
    if (!row) return null;
    row[attr] = val;
    delete (row as any).__memory;
    updateReferences(model, row);
    addRowToGroups(model, row);
    return row;
  };

  const findOne = <T extends ModelRow>(
    model: SpecifiedModels,
    value: string,
    attribute?: string,
    ignoreDb = false
  ): T | null | Promise<T | null> => {
    const pk = LOCAL_PRIMARY_KEYS[model as keyof typeof LOCAL_PRIMARY_KEYS];
    const hit = attribute
      ? Object.values(local[model]).find((r) => r[attribute] === value)
      : findWithPrimaryOrReference<T>(model, value);

    if (hit) return hit as T;
    if (ignoreDb) return null;

    const Model: ModelStatic<any> = (db as any)[model];
    /* findOne – now */
    return Model.findOne({
      where: { [attribute ?? pk]: value },
      raw: true,
    }) as Promise<T | null>;
  };

  const fetchGroupLocally = (
    model: SpecifiedModels,
    groupKey: string,
    value: IndexKey
  ) => groups[model]?.[groupKey]?.[value] ?? [];

  type StringFilter = string; // primary key OR reference
  type PairFilter = [unknown, string]; // [value, attribute]
  type ObjFilter = Record<string, unknown>;
  type Filter = StringFilter | PairFilter | ObjFilter | Filter[];

  const filterType = (f: Filter): "string" | "array" | "object" => {
    if (typeof f === "string") return "string";
    if (Array.isArray(f)) return "array";
    return "object";
  };

  const findManyInFilter = <T extends ModelRow>(
    model: SpecifiedModels,
    filters: Filter[],
    ignoreDb = false
  ): T[] | Promise<T[]> => {
    const testAttr = (row: T, f: Filter): boolean => {
      const t = filterType(f);
      if (t === "string")
        return (
          row[LOCAL_PRIMARY_KEYS[model as keyof typeof LOCAL_PRIMARY_KEYS]] ===
          f
        );
      if (t === "object") {
        const [[a, v]] = Object.entries(f as ObjFilter);
        return row[a] === v;
      }
      return (f as Filter[]).every((leaf) => testAttr(row, leaf));
    };

    /* local pass */
    if (!filters.length) return [];

    /* local pass */
    const localRows = filters.every((f) => typeof f === "string")
      ? ((filters as string[])
          .map((k) => findWithPrimaryOrReference(model, k))
          .filter(Boolean) as ModelRow[])
      : Object.values(local[model]).filter((row) =>
          filters.some((flt) => testAttr(row as T, flt))
        );

    if (ignoreDb) return localRows as T[];

    /* build Sequelize OR */
    const toSeq = (f: Filter): ObjFilter => {
      const t = filterType(f);
      if (t === "string") {
        const pk = LOCAL_PRIMARY_KEYS[model as keyof typeof LOCAL_PRIMARY_KEYS];
        return { [pk]: f };
      }
      if (t === "object") return f as ObjFilter;
      return { [Op.and]: (f as Filter[]).map(toSeq) };
    };

    const Model: ModelStatic<any> = (db as any)[model];
    return new Promise(async (resolve) => {
      const dbRows = (await Model.findAll({
        raw: true,
        where: { [Op.or]: filters.map(toSeq) },
      })) as T[];

      resolve(
        removeItemsWithDuplicateProp([...localRows, ...dbRows], "id") as T[]
      );
    });
  };

  const create = <T extends ModelRow>(
    model: SpecifiedModels,
    data: Record<string, Scalar>
  ): T => {
    const pk = LOCAL_PRIMARY_KEYS[model as keyof typeof LOCAL_PRIMARY_KEYS];
    cachedAutoIncrements[model] = (cachedAutoIncrements[model] ?? 0) + 1;

    const row = buildIndexes(
      { id: cachedAutoIncrements[model], ...data },
      model
    );
    local[model][row[pk] as IndexKey] = row;
    updateReferences(model, row);
    addRowToGroups(model, row);
    return row as T;
  };

  const findOrCreate = <T extends ModelRow>(
    model: SpecifiedModels,
    key: string,
    defaults: Record<string, Scalar>,
    ignoreDb = true
  ): T => {
    const found = findOne(model, key, undefined, ignoreDb);
    if (found && !(found instanceof Promise)) return found as T;
    return create<T>(model, defaults);
  };

  const clear = () => {
    genDefaultCache();
    global.gc?.();
  };

  const commitChanges = async () => {
    const CHUNK = Number.parseInt(
      process.env.MAX_COMMIT_CHUNK_SIZE ?? "1500",
      10
    );
    const trx = await db.sequelize.transaction();
    try {
      for (const [model, rowsObj] of Object.entries(local)) {
        const rows = Object.values(rowsObj)
          .filter((r) => !(r as any).__memory)
          .map((r) => {
            const copy = { ...r };
            const cfg = BUILD_FIELDS[model as keyof typeof BUILD_FIELDS];
            if (cfg) Object.keys(cfg).forEach((f) => delete copy[f]);
            return copy;
          });

        if (!rows.length) continue;
        const Model: ModelStatic<any> = (db as any)[model];

        for (const chunk of chunkify(rows, CHUNK)) {
          await Model.bulkCreate(chunk, {
            transaction: trx,
            updateOnDuplicate: Object.keys(Model.rawAttributes).filter(
              (f) => f !== "createdAt"
            ),
          });
        }

        const plural = pluralize(model.toLowerCase());
        if (cachedAutoIncrements[model] > 0) {
          await db.sequelize.query(
            `SELECT setval('${plural}_id_seq', ${cachedAutoIncrements[model]}, true)`
          );
        }
      }
      await trx.commit();
    } catch (e) {
      await trx.rollback();
      log(`(storage) commit failed: ${e}`, "panic");
      throw e;
    } finally {
      clear();
    }
  };

  await init();

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
    fetchGroupLocally,
    clear,
  };
}

export type IStorage = Awaited<ReturnType<typeof storage>>;

/* common‑JS compatibility */
export default { storage };
