const memory = require('./memory.js');

async function set(id, key, value, ttl) {
  return memory.set(`delayed_memory:${id}`, { key: key, value: value, ttl: ttl }, 60 * 60 * 6)
    .then(() => id);
}

async function materialize(id) {
  return memory.consume(`delayed_memory:${id}`, null)
    .then(delayed => {
      if (delayed) {
        return memory.set(delayed.key, delayed.value, delayed.ttl).then(() => true);
      } else {
        return false;
      }
    });
}

module.exports = { set, materialize }
