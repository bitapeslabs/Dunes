function decodeSome(obj) {
    const parentNode = obj._value ? obj._value : obj;

    if(typeof parentNode !== 'object') {
        return parentNode;
    }

    for (let key in parentNode) {
        if (parentNode[key] && parentNode[key]._value) {
            parentNode[key] = decodeSome(parentNode[key]);
        }
    }
    return parentNode;
}

module.exports = {
    decodeSome
}