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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  fromBigInt,
  toBigInt,
  pluralize,
  stripObject,
  sleep,
  replacer,
  stripValue,
};
