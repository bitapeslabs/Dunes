const isSafeChar = Number("0x" + Buffer.from("π").toString("hex"));
console.log(isSafeChar);
