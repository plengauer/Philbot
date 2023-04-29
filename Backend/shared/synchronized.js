
var locks = {};

async function locked(key, func) {
    if (locks[key]) return locks[key].then(() => locked(key, func));
    locks[key] = new Promise((resolve, reject) => func().then(result => resolve(result)).catch(error => reject(error)));
    // shouldnt this just be "locks[key] = func()" ? - no, because then the context propagation of otel tracing will make weird paths. we avoid this my wrapping in our own promise
    return locks[key].finally(() => { delete locks[key]; });
}

module.exports = { locked }
