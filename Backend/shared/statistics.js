const lib = require('lib')({token: process.env.STDLIB_SECRET_TOKEN});
const memory = require('./memory.js');

async function increment(key, ttl) {
  return memory.get(key, 0).then(value => memory.set(key, value + 1, ttl));
}

function strip(id, key) {
  let needle = ':' + key + ':';
  while(id.includes(needle)) {
    let f = id.indexOf(needle);
    let t = id.indexOf(':', f + needle.length + 1);
    if (t < 0) t = id.length;
    if (t < id.length && id.charAt(t) == ':') t++;
    id = id.substring(0, f) + ':' + id.substring(t, id.length);
  }
  if (id.startsWith(':')) {
    id = id.substring(1);
  }
  if (id.endsWith(':')) {
    id = id.substring(0, id.length - 1);
  }
  return id;
}

function simplify(id) {
  id = strip(id, 'guild');
  id = strip(id, 'channel');
  id = strip(id, 'role');
  id = strip(id, 'user');
  id = strip(id, 'activity');
  return id;
}

const PREFIX = 'statistics:';

async function record(id) {
  // id = simplify(id);
  return increment(PREFIX + id, 60 * 60 * 24 * 7 * 53);
}

async function get(id) {
  return memory.get(PREFIX + id, 0);
}

async function list(filter) {
  return memory.list().then(entries => entries.filter(entry => entry.key.startsWith(PREFIX) && filter(entry.key.substring(PREFIX.length))));
}

async function reset() {
  let counts = {};
  return list(key => true)
    .then(entries => Promise.all(entries
      .map(entry => memory.unset(entry.key)
        .then(() => simplify(entry.key.endsWith(':total') ? entry.key.substring(0, entry.key.length - ':total'.length) : entry.key))
        .then(key => counts[key] = (counts[key] ? counts[key] : 0) + entry.value)
      ))
    ).then(() => {
      let result = [];
      for (let id in counts) result.push(id);
      return result;
    }).then(ids => ids.map(id => memory.set(id + ':total', counts[id])))
    .then(results => Promise.all(results));
  /*
  let counts = {};
  return list(key => true)
    .then(entries => entries
      .map(entry => (entry.key.endsWith(':total') ? Promise.resolve() : memory.unset(entry.key)).then(() => entry))
      .map(entry => {
        return {
          key: simplify(entry.key.endsWith(':total') ? entry.key.substring(0, entry.key.length - ':total'.length) : entry.key),
          count: entry.value 
        };
      }).map(entry => counts[entry.key] = (counts[entry.key] ? counts[entry.key] : 0) + entry.count)
    ).then(() => {
      let result = [];
      for (let id in counts) result.push(id);
      return result;
    }).then(ids => ids.map(id => memory.set(id + ':total', counts[id])))
    .then(results => Promise.all(results));
    */
}

async function count(filter) {
  return list(filter)
    .then(entries => entries.map(entry => entry.value))
    .then(counts => counts.reduce((c1, c2) => c1 + c2, 0));
}

module.exports = { record, get, list, reset, count }
