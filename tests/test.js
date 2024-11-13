const {
  process_json_input,
} = require("../src/rpc/runes/lib/native/pkg/nana_parsers.js");

// Example data
console.log(process_json_input(JSON.stringify(["1"]), 0, 0, 0));
