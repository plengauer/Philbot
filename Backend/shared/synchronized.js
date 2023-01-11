
var locks = {};

async function locked(key, func) {
    if (locks[key]) return locks[key].then(() => locked(key, func));
    locks[key] = new Promise((resolve, reject) => func().then(result => resolve(result)).catch(error => reject(error)));
    return locks[key].finally(() => { delete locks[key]; });
}

module.exports = { locked }
