const memory = require('./memory.js');
const retry = require('./retry.js');

function generateEntries(id) {
  let magic = '' + Math.floor(Math.random() * 1000000);
  let entries = [];
  for (let component of [null, 'user:123', 'channel:123', 'role:123', 'guild:123', 'activity:123', 'statistics:foo']) {
    for (let i = 0; i < 3; i++) {
      let key = 'test:' + id + ':' + magic + ':' + entries.length + (component ? ':' + component : '');
      let entry = { key: key, value: key + '___value', ttl: 60 };
      entries.push(entry);
    }
  }
  return entries;
}

async function testAPI_set_get_unset_get() {
  let entries = generateEntries('testAPI_set_get_unset_get');
  await Promise.all(entries.map(entry => memory.set(entry.key, entry.value, entry.ttl)));
  let values = await Promise.all(entries.map(entry => memory.get(entry.key, null)));
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].value !== values[i]) throw new Error('API set+get mismatch: ' + entries[i].key + ' = ' + values[i]);
  }
  await Promise.all(entries.map(entry => memory.set(entry.key, entry.value + '.new', entry.ttl)));
  values = await Promise.all(entries.map(entry => memory.get(entry.key, null)));
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].value + '.new' !== values[i]) throw new Error('API set+get mismatch: ' + entries[i].key + ' = ' + values[i]);
  }
  await Promise.all(entries.map(entry => memory.unset(entry.key)));
  values = await Promise.all(entries.map(entry => memory.get(entry.key, null)));
  if (values.some(value => value != null)) throw new Error('API set+unset+get mismatch');
}

async function testAPI_fill_list_clear_list() {
  let entries = generateEntries('testAPI_fill_list_clear_list');
  let timestamp = new Date();
  let ratio = 2;
  let reduced_entries = [];
  for (let i = 0; i < entries.length; i++) if (i % ratio == 0) reduced_entries.push(entries[i]);
  await memory.fill(reduced_entries);
  let list = await memory.list(entries.map(entry => entry.key));
  if (list.length != reduced_entries.length) throw new Error('API fill+list mismatch (count): ' + list.length);
  if (!list.every(entry => reduced_entries.map(re => re.key).includes(entry.key))) throw new Error('API fill+list mismatch (keys): ' + list.map(entry => entry.key).filter(key => !reduced_entries.map(re => re.key).includes(key)).join(' '));
  if (!list.every(entry => reduced_entries.map(re => re.value).includes(entry.value))) throw new Error('API fill+list mismatch (values): ' + list.map(entry => entry.key + '=' + entry.value).join(';'));
  if (!list.every(entry => entry.ttl == 60)) throw new Error('API fill+list mismatch (ttl): ' + entry.ttl);
  if (!list.every(entry => timestamp.getTime() <= entry.timestamp && entry.timestamp <= Date.now())) throw new Error('API fill+list mismatch (timestamp)');
  await memory.clear(entries.map(entry => entry.key));
  list = await memory.list(entries.map(entry => entry.key));
  if (list.length !== 0) throw new Error('API fill+list+clear mismatch (' + (list.map(e => e.key).join(', ')) + ')');
}

async function testAPI_set_ttl() {
  let entries = generateEntries('testAPI_set_ttl');
  await memory.set(entries[0].key, entries[0].value, 5);
  let value = await memory.get(entries[0].key, null);
  if (value !== entries[0].value) throw new Error('API+set(<ttl) mismatch');
  await retry.delay(1000 * 5);
  value = await memory.get(entries[0].key, null);
  if (value !== null) throw new Error('API+set(>ttl) mismatch');
}

async function testAPIs() {
  return Promise.all([
      testAPI_set_get_unset_get(),
      testAPI_fill_list_clear_list(),
      testAPI_set_ttl()
    ]);
}

async function verify() {
  let keys = new Set();
  let notUniqueKeys = new Set();
  let entries = await memory.list();
  for (let entry of entries) {
    if (!entry.key) throw new Error('No key');
    if (entry.key.length == 0) throw new Error('Empty key');
    if (!entry.timestamp) throw new Error('No timestamp');
    if (entry.ttl && isNaN(entry.ttl)) throw new Error('TTL NaN');
    if (isNaN(entry.timestamp)) throw new Error('Timestamp NaN');
    if (entry.ttl && entry.timestamp + entry.ttl * 1000 + 60 * 1000 < Date.now()) throw new Error('Expired: ' + entry.key);
    if (keys.has(entry.key)) notUniqueKeys.add(entry.key);
    keys.add(entry.key);
  }
  keys.clear();
  for (let entry of await memory.list(Array.from(notUniqueKeys))) {
    if (keys.has(entry.key)) throw new Error('Duplicate key: ' + entry.key);
    keys.add(entry.key);
  }
}

module.exports = { verify, testAPIs }
