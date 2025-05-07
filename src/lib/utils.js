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

const mergeSortArrayOfObj = (array, field) => {
  if (array.length <= 1) {
    return array;
  }

  const middle = Math.floor(array.length / 2);
  const left = array.slice(0, middle);
  const right = array.slice(middle);

  return mergeObj(
    mergeSortArrayOfObj(left, field),
    mergeSortArrayOfObj(right, field),
    field
  );
};

const mergeObj = (left, right, field) => {
  let resultArray = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex][field] < right[rightIndex][field]) {
      resultArray.push(left[leftIndex]);
      leftIndex++;
    } else {
      resultArray.push(right[rightIndex]);
      rightIndex++;
    }
  }

  // Concatenate the remaining elements if any
  return resultArray
    .concat(left.slice(leftIndex))
    .concat(right.slice(rightIndex));
};

// Example usage:

const log = (message, type) => {
  if (type === "debug" && !process.argv.includes("--debug")) return;
  //Get current date and hour and add it to the message
  const date = new Date();
  console.log(`${date.toISOString()}: DUNES > (${type ?? "stat"}) ${message}`);
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

const stripFields = (obj, fields) => {
  if (typeof obj !== "object" || obj === null) {
    return obj; // Base case: if the object is not an object or is null, return it as is
  }
  let cloneObj = { ...obj };

  // Recursively call stripFields on each property of the object
  for (const key in cloneObj) {
    if (cloneObj.hasOwnProperty(key) && fields.includes(key)) {
      delete cloneObj[key];
    }
  }

  return Object.keys(cloneObj).length ? cloneObj : null;
};

const includeOnlyFields = (obj, fields) => {
  if (typeof obj !== "object" || obj === null) {
    return obj; // Base case: if the object is not an object or is null, return it as is
  }

  let cloneObj = { ...obj };

  // Recursively call stripFields on each property of the object
  for (const key in cloneObj) {
    if (cloneObj.hasOwnProperty(key) && !fields.includes(key)) {
      delete cloneObj[key];
    }
  }

  return Object.keys(cloneObj).length ? cloneObj : null;
};

const simplify = (obj) => {
  // Helper function to determine if an object has only one key
  function hasOneKey(obj) {
    return (
      typeof obj === "object" && obj !== null && Object.keys(obj).length === 1
    );
  }

  // Recursively simplify the object
  function process(obj) {
    if (Array.isArray(obj)) {
      return obj.map((item) => process(item));
    } else if (typeof obj === "object" && obj !== null) {
      let result = {};

      for (const [key, value] of Object.entries(obj)) {
        if (
          hasOneKey(value) &&
          typeof value[Object.keys(value)[0]] !== "object"
        ) {
          // If the value is an object with only one key and the value of that key is not an object, simplify it
          result[key] = value[Object.keys(value)[0]];
        } else {
          // Otherwise, recursively process the value
          result[key] = process(value);
        }
      }

      return result;
    } else {
      return obj;
    }
  }

  return process(obj);
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
function btcToSats(val) {
  const str = val.toString();
  const [whole, frac = ""] = str.split(".");
  const wholeSats = BigInt(whole) * 100_000_000n;
  const fracSats = BigInt(frac.padEnd(8, "0").slice(0, 8));
  return wholeSats + fracSats;
}

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
  btcToSats,
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
  simplify,
  stripFields,
  includeOnlyFields,
};
