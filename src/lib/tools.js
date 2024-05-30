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



module.exports = {
    fromBigInt,
    toBigInt
}