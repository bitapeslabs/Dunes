function stripValue(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return obj; // Base case: if the object is not an object or is null, return it as is
    }
  
    if (obj.hasOwnProperty('_value')) {
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
    if (typeof value === 'function') {
      return undefined; // Remove methods
    }

    if (typeof value === 'bigint') {
        return value.toString(); // parse bigints
      }
    return value; // Keep everything else
  }


function stripObject(obj){
    return JSON.parse(JSON.stringify(obj, replacer, 2))
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
    stripObject,
    sleep,
    replacer,
    stripValue
}