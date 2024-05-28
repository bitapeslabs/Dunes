const fromBigInt = (number, decimals) => {
    const quotient = BigInt(number) / BigInt('1'+'0'.repeat(decimals))
    const remainder = sum % divisor;

    const decimalResult = `${quotient}.${remainder.toString().padStart(18, '0')}`;
    return decimalResult
}
const toBigInt = (numberStr, decimals) => {
    const [integerPart, fractionalPart = ''] = numberStr.split('.');
    const integerBigInt = BigInt(integerPart);
    const fractionalBigInt = BigInt(fractionalPart.padEnd(decimals, '0'));
    
    const divisor = BigInt('1' + '0'.repeat(decimals));
    
    const resultBigInt = integerBigInt * divisor + fractionalBigInt;
    
    return resultBigInt.toString()
}

const runes = {
    getReservedName : (block, tx)  =>  {
        const baseValue = BigInt("6402364363415443603228541259936211926");
        const combinedValue = (BigInt(block) << 32n) | BigInt(tx);
        return baseValue + combinedValue;
    }
}


module.exports = {
    fromBigInt,
    toBigInt,
    runes
}