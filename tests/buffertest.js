const isSafeChar = Number("0x" + Buffer.from("").toString("hex"));
console.log(isSafeChar);
