import { isPromise } from "util/types";
import chalk from "chalk";

export function fromBigInt(amount: string | bigint, decimals: number): string {
  const divisor = BigInt("1" + "0".repeat(decimals));
  const value = BigInt(amount);
  const quotient = value / divisor;
  const remainder = value % divisor;
  return `${quotient}.${remainder.toString().padStart(decimals, "0")}`;
}

//Check if T is not null or Promise
export const isValidResponse = <T>(
  response: T | null | Promise<unknown>
): response is T => {
  return (
    response !== null && typeof response !== "undefined" && !isPromise(response)
  );
};

export function getNoBigIntObject<T extends object>(obj: T): string {
  return JSON.parse(
    JSON.stringify(obj, (_, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );
}

export function toBigInt(amountStr: string, decimals: number): string {
  const [integerPart, fractionalPart = ""] = amountStr.split(".");
  const integer = BigInt(integerPart);
  const fractional = BigInt(fractionalPart.padEnd(decimals, "0"));
  const multiplier = BigInt("1" + "0".repeat(decimals));
  return (integer * multiplier + fractional).toString();
}

export function mergeSortArrayOfObj<T>(array: T[], field: keyof T): T[] {
  if (array.length <= 1) return array;
  const middle = Math.floor(array.length / 2);
  const left = mergeSortArrayOfObj(array.slice(0, middle), field);
  const right = mergeSortArrayOfObj(array.slice(middle), field);
  return mergeObj(left, right, field);
}

function mergeObj<T>(left: T[], right: T[], field: keyof T): T[] {
  const result: T[] = [];
  let l = 0,
    r = 0;
  while (l < left.length && r < right.length) {
    if (left[l][field] < right[r][field]) {
      result.push(left[l++]);
    } else {
      result.push(right[r++]);
    }
  }
  return result.concat(left.slice(l)).concat(right.slice(r));
}

export function log(message: string, type: string = "stat"): void {
  if (type === "debug" && !process.argv.includes("--debug")) return;
  const timestamp = new Date().toISOString();
  console.log(
    chalk.cyan(`${timestamp}: MEZCAL > (${type}) ${chalk.yellow(message)}`)
  );
}

export function pluralize(word: string): string {
  if (/[^aeiou]y$/.test(word)) return word.replace(/y$/, "ies");
  if (/(s|sh|ch|x|z)$/.test(word)) return word + "es";
  if (/fe?$/.test(word)) return word.replace(/fe?$/, "ves");
  return word + "s";
}

export function stripFields<T extends object>(
  obj: T,
  fields: (keyof T)[]
): Partial<T> | null {
  const clone = { ...obj };
  for (const key of fields) delete clone[key];
  return Object.keys(clone).length ? clone : null;
}

export function includeOnlyFields<T extends object>(
  obj: T,
  fields: (keyof T)[]
): Partial<T> | null {
  const filtered: Partial<T> = {};
  for (const key of fields) {
    if (key in obj) filtered[key] = obj[key];
  }
  return Object.keys(filtered).length ? filtered : null;
}

export function simplify<T>(obj: T): T {
  // Objects we've already visited – prevents infinite loops on cycles
  const seen = new WeakSet<object>();

  function collapse(value: unknown): unknown {
    // primitives (string, number, bigint, boolean, symbol, undefined, null)
    if (value === null || typeof value !== "object") return value;

    // break cycles
    if (seen.has(value)) return value;
    seen.add(value as object);

    // arrays – process each element
    if (Array.isArray(value)) {
      return value.map(collapse);
    }

    // plain object
    const keys = Object.keys(value as Record<string, unknown>);

    if (
      keys.length === 1 &&
      typeof (value as Record<string, unknown>)[keys[0]] !== "object"
    ) {
      // collapse { k: primitive } => primitive
      return (value as Record<string, unknown>)[keys[0]];
    }

    // recurse normally
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k] = collapse((value as Record<string, unknown>)[k]);
    }
    return out;
  }

  return collapse(obj) as T;
}

export function stripValue(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if ("_value" in obj)
    return stripValue((obj as Record<string, unknown>)._value);
  const result: Record<string, unknown> = {
    ...(obj as Record<string, unknown>),
  };
  for (const key in result) {
    result[key] = stripValue(result[key]);
  }
  return result;
}

function replacer(_: string, value: unknown): unknown {
  if (typeof value === "function") return undefined;
  if (typeof value === "bigint") return value.toString();
  return value;
}

export function stripObject<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj, replacer));
}

export function convertAmountToParts(amount: bigint): {
  balance_0: string;
  balance_1: string;
} {
  const MAX_64_UNSIGNED = 0xffffffffffffffffn;
  const MAX_64_SIGNED = 0x7fffffffffffffffn;
  let lower64 = amount & MAX_64_UNSIGNED;
  let upper64 = (amount >> 64n) & MAX_64_UNSIGNED;
  if (lower64 > MAX_64_SIGNED) lower64 -= MAX_64_UNSIGNED + 1n;
  if (upper64 > MAX_64_SIGNED) upper64 -= MAX_64_UNSIGNED + 1n;
  return {
    balance_0: lower64.toString(),
    balance_1: upper64.toString(),
  };
}

export function convertPartsToAmount(
  balance_0: string | bigint,
  balance_1: string | bigint
): bigint {
  const MAX_64_UNSIGNED = 0xffffffffffffffffn;
  let b0 = BigInt(balance_0);
  let b1 = BigInt(balance_1);
  if (b0 < 0) b0 += MAX_64_UNSIGNED + 1n;
  if (b1 < 0) b1 += MAX_64_UNSIGNED + 1n;
  return (b1 << 64n) | b0;
}

export function removeItemsWithDuplicateProp<T>(
  array: T[],
  prop: keyof T
): T[] {
  const seen = new Set<unknown>();
  return array.filter((item) => {
    const val = item[prop];
    if (seen.has(val)) return false;
    seen.add(val);
    return true;
  });
}

export function btcToSats(val: number | string): bigint {
  const str = val.toString();
  const [whole, frac = ""] = str.split(".");
  const wholeSats = BigInt(whole) * 100_000_000n;
  const fracSats = BigInt(frac.padEnd(8, "0").slice(0, 8));
  return wholeSats + fracSats;
}

export function chunkify<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

export function* chunkifyIter<T>(
  arr: readonly T[],
  size: number
): Iterable<T[]> {
  for (let i = 0; i < arr.length; i += size) {
    yield arr.slice(i, i + size);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Converts satoshis to BTC (1 BTC = 100,000,000 sats)
 * @param sats - A number representing satoshis
 * @returns number representing BTC (e.g. 100000000 -> 1.0)
 */
export function satsToBTC(sats: number): number {
  if (!Number.isFinite(sats)) throw new Error("Invalid satoshi input");
  return sats / 100_000_000;
}
