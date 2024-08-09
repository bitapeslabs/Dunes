const { MAX_SIGNED_128_BIT_INT } = require("./constants");

const fromBigInt = (number, decimals) => {
  const quotient = BigInt(number) / BigInt("1" + "0".repeat(decimals));
  const remainder = sum % divisor;

  const decimalResult = `${quotient}.${remainder.toString().padStart(18, "0")}`;
  return decimalResult;
};
const toBigInt = (numberStr, decimals) => {
  const [integerPart, fractionalPart = ""] = numberStr.split(".");
  const integerBigInt = BigInt(integerPart);
  const fractionalBigInt = BigInt(fractionalPart.padEnd(decimals, "0"));

  const divisor = BigInt("1" + "0".repeat(decimals));

  const resultBigInt = integerBigInt * divisor + fractionalBigInt;

  return resultBigInt.toString();
};

const log = (message, type) => {
  if (type === "debug" && !process.argv.includes("--debug")) return;
  //Get current date and hour and add it to the message
  const date = new Date();
  console.log(`${date.toISOString()}: NANA > (${type ?? "stat"}) ${message}`);
};

const pluralize = (word) => {
  // If the word ends in 'y' and is preceded by a consonant, replace 'y' with 'ies'
  if (word.match(/[^aeiou]y$/)) {
    return word.replace(/y$/, "ies");
  }
  // If the word ends in 's', 'sh', 'ch', 'x', or 'z', add 'es'
  else if (word.match(/(s|sh|ch|x|z)$/)) {
    return word + "es";
  }
  // If the word ends in 'f', replace with 'ves'
  else if (word.match(/f$/)) {
    return word.replace(/f$/, "ves");
  }
  // If the word ends in 'fe', replace with 'ves'
  else if (word.match(/fe$/)) {
    return word.replace(/fe$/, "ves");
  }
  // For most other words, add 's'
  else {
    return word + "s";
  }
};

function stripValue(obj) {
  if (typeof obj !== "object" || obj === null) {
    return obj; // Base case: if the object is not an object or is null, return it as is
  }

  if (obj.hasOwnProperty("_value")) {
    return stripValue(obj._value); // If the object has a _value property, recursively call stripValue on it
  }

  // Recursively call stripValue on each property of the object
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      obj[key] = stripValue(obj[key]);
    }
  }

  return obj;
}

function replacer(key, value) {
  if (typeof value === "function") {
    return undefined; // Remove methods
  }

  if (typeof value === "bigint") {
    return value.toString(); // parse bigints
  }
  return value; // Keep everything else
}

function stripObject(obj) {
  return JSON.parse(JSON.stringify(obj, replacer, 2));
}

//takes in signed 64bit int parts and returns u128 bit bigint

/*
We store balances as unsigned 128 bit integers on SQL by storing two BIGINT types which have a fixed size of 64 bits.
We do this so we can store the full 128 bit integer in two columns and avoid using the DECIMAL type which is slower.
*/

//takes in u128 bit bigint and returns signed 64bit int parts
const convertAmountToParts = (amount) => {
  const MAX_64_UNSIGNED = 0xffffffffffffffffn;
  const MAX_64_SIGNED = 0x7fffffffffffffffn;

  // Get the lower 64 bits
  let lower64 = amount & MAX_64_UNSIGNED;

  // Get the upper 64 bits by shifting right 64 bits
  let upper64 = (amount >> 64n) & MAX_64_UNSIGNED;

  // Convert to signed 64-bit integers
  if (lower64 > MAX_64_SIGNED) {
    lower64 -= MAX_64_UNSIGNED + 1n;
  }

  if (upper64 > MAX_64_SIGNED) {
    upper64 -= MAX_64_UNSIGNED + 1n;
  }

  return {
    balance_0: lower64.toString(),
    balance_1: upper64.toString(),
  };
};

function convertPartsToAmount(balance_0, balance_1) {
  const MAX_64_UNSIGNED = 0xffffffffffffffffn;

  balance_0 = BigInt(balance_0);
  balance_1 = BigInt(balance_1);

  // Convert lower64Signed to its unsigned equivalent
  let lower64 = balance_0 < 0 ? balance_0 + MAX_64_UNSIGNED + 1n : balance_0;
  // Convert upper64Signed to its unsigned equivalent
  let upper64 = balance_1 < 0 ? balance_1 + MAX_64_UNSIGNED + 1n : balance_1;

  // Combine upper64 and lower64 into a single 128-bit integer
  return (upper64 << 64n) | lower64;
}

const removeItemsWithDuplicateProp = (array, prop) => {
  return array.reduce(function (acc, item) {
    // if the next object's id is not found in the output array
    // push the object into the output array
    if (!acc.some((testElement) => testElement[prop] === item[prop]))
      acc.push(item);
    return acc;
  }, []);
};

const chunkify = (array, len) => {
  // Initialize an empty array to hold the chunks
  let chunks = [],
    i = 0,
    n = array.length;

  while (i < n) {
    chunks.push(array.slice(i, (i += len)));
  }

  return chunks;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  fromBigInt,
  toBigInt,
  pluralize,
  stripObject,
  sleep,
  replacer,
  stripValue,
  removeItemsWithDuplicateProp,
  log,
  chunkify,
  convertPartsToAmount,
  convertAmountToParts,
};
