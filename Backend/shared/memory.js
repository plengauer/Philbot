const discord = require('./discord.js')
const memory_kv = require('./memory_kv.js');
const memory_google_sheet = require('./memory_google_sheet.js');
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode.memory');

// these functions are a facade for several different backends with different advantages
// kv:
//   + fast (~ 200ms)
//   + unlimited read/write access
//   - 1024 max size
// google sheet:
//   + unlimited size
//   - slower (~ 1s)
//   - limited read/write access (60 transactions per minute per read/write respectively)

const CONFIG_KEY = 'config:memory';
const THRESHOLD = 0.8;

async function memory_kv_clear(keys) {
  return keys ?
    memory_kv.clear(keys.filter(key => key !== CONFIG_KEY)) :
    memory_kv.list().then(entries => memory_kv_clear(entries.map(entry => entry.key).filter(key => key !== CONFIG_KEY)));
}

////////////////////////////////////////////////////////////

async function clean_null() {
  return Promise.all([
      memory_kv.clear(), // intentionally clear all
      memory_google_sheet.clear()
    ]);
}

async function get_null(key, backup) {
  return backup;
}

async function list_null(keys) {
  return [];
}

async function set_null(key, value, ttl) {
  return undefined;
}

async function fill_null(entries) {
  return undefined;
}

async function unset_null(key) {
  return undefined;
}

async function clear_null(keys) {
  return undefined;
}

////////////////////////////////////////////////////////////

async function migrate_null_to_kv() {
  return undefined;
}

async function migrate_kv_to_null() {
  return undefined;
}

////////////////////////////////////////////////////////////

async function clean_kv() {
  return Promise.all([
      memory_kv.clean(),
      memory_google_sheet.clear()
    ]);
}

async function get_kv(key, backup) {
  return memory_kv.get(key, backup);
}

async function list_kv(keys) {
  return memory_kv.list(keys);
}

async function set_kv(key, value, ttl) {
  return memory_kv.set(key, value, ttl);
}

async function fill_kv(entries) {
  return memory_kv.fill(entries);
}

async function unset_kv(key) {
  return memory_kv.unset(key);
}

async function clear_kv(keys) {
  return memory_kv_clear(keys);
}

////////////////////////////////////////////////////////////

async function migrate_kv_to_rare(isRareKey) {
  return memory_kv.list().then(entries => memory_google_sheet.fill(entries.filter(entry => !isRareKey(entry.key))));
}

async function migrate_rare_to_kv() {
  return memory_google_sheet.list().then(memory_kv.fill);
}

////////////////////////////////////////////////////////////

function isRareKey_a(key) {
  return !key.includes(':user:');
}
function isRareKey_b(key) {
  return isRareKey_a(key) && !key.includes(':role:');
}
function isRareKey_c(key) {
  return isRareKey_b(key) && !key.includes(':channel:');
}
function isRareKey_d(key) {
  return isRareKey_c(key) && !key.includes(':guild:');
}
function isRareKey_e(key) {
  return isRareKey_d(key) && !key.includes(':activity:');
}

async function migrate_rare_to_rare_down(isRareKey) {
  return memory_google_sheet.list().then(entries => memory_kv.fill(entries.filter(entry => isRareKey(entry.key))));
}

async function migrate_rare_to_rare_up(isRareKey) {
  return memory_kv.list().then(entries => memory_google_sheet.fill(entries.filter(entry => !isRareKey(entry.key))))
}

async function clean_rare(isRareKey) {
  return Promise.all([
      memory_kv.clean(),
      memory_google_sheet.clean()
    ]).then(() => Promise.all([
      memory_kv.list().then(entries => memory_kv_clear(entries.map(entry => entry.key).filter(key => !isRareKey(key)))),
      memory_google_sheet.list().then(entries => memory_google_sheet.clear(entries.map(entry => entry.key).filter(key => isRareKey(key))))
    ]));
}

async function get_rare(isRareKey, key, backup) {
  return isRareKey(key) ? memory_kv.get(key, backup) : memory_google_sheet.get(key, backup);
}

async function list_rare(isRareKey, keys) {
  // known limitation, for the time of migration, listing without keys may return entries double'd
  return Promise.all([
      memory_kv.list(keys ? keys.filter(key => isRareKey(key)) : undefined),
      memory_google_sheet.list(keys ? keys.filter(key => !isRareKey(key)) : undefined)
    ]).then(lists => lists.reduce((l1, l2) => l1.concat(l2), []));
}

async function set_rare(isRareKey, key, value, ttl) {
  return isRareKey(key) ? memory_kv.set(key, value, ttl) : memory_google_sheet.set(key, value, ttl);
}

async function fill_rare(isRareKey, entries) {
  return Promise.all([
      memory_kv.fill(entries.filter(entry => isRareKey(entry.key))),
      memory_google_sheet.fill(entries.filter(entry => !isRareKey(entry.key)))
    ]);
}

async function unset_rare(isRareKey, key) {
  return isRareKey(key) ? memory_kv.unset(key) : memory_google_sheet.unset(key);
}

async function clear_rare(isRareKey, keys) {
  return Promise.all([
      memory_kv_clear(keys ? keys.filter(key => isRareKey(key)) : undefined),
      memory_google_sheet.clear(keys ? keys.filter(key => !isRareKey(key)) : undefined)
    ]);
}

////////////////////////////////////////////////////////////

async function migrate_rare_to_gs() {
  return memory_kv.list().then(memory_google_sheet.fill);
}

async function migrate_gs_to_rare(isRareKey) {
  return memory_google_sheet.list().then(entries => memory_kv.fill(entries.filter(entry => isRareKey(entry.key))));
}

////////////////////////////////////////////////////////////

async function clean_gs() {
  return Promise.all([
      memory_kv_clear(),
      memory_google_sheet.clean()
    ]);
}

async function get_gs(key, backup) {
  return memory_google_sheet.get(key, backup);
}

async function list_gs(keys) {
  return memory_google_sheet.list(keys);
}

async function set_gs(key, value, ttl) {
  return memory_google_sheet.set(key, value, ttl);
}

async function fill_gs(entries) {
  return memory_google_sheet.fill(entries);
}

async function unset_gs(key) {
  return memory_google_sheet.unset(key, value, ttl);
}

async function clear_gs(keys) {
  return memory_google_sheet.clear(keys);
}

////////////////////////////////////////////////////////////

let c = null;

async function config() {
  return c ? c : c = memory_kv.get(CONFIG_KEY, { mode: 0 });
}

// to make all transitions smooth and handle cases where memory is read and modified during cleanup and transition, we need intermediary step
// that step writes only the new way, but reads both ways and does not make any migration yet
// the second step a day later then migrates all data AND THEN clears the old and switched the mode fully
// then a day later, we completely switch and after we clear the old memory entries that are not necessary anymore
// we still have to clear all though, and also not overwrite filling - we solve that to also write both ways immediately, so all overwrites will be same value

async function clean() {
  let mode = (await config()).mode;
  let span = tracer.startSpan('autocode.memory.clean');
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
    switch(mode) {
      case 0: return clean_null()
        .then(() => discord.guilds_list())
        .then(guilds => guilds.length > 0 ?
          memory_kv.set(CONFIG_KEY, { mode: 021 }) :
          Promise.resolve()
        );
      case 1: return clean_kv()
        .then(() => memory_kv.count())
        .then(count => count > memory_kv.capacity() * THRESHOLD ?
          memory_kv.set(CONFIG_KEY, { mode: 122 }) :
          discord.guilds_list().then(guilds => guilds.length == 0 ?
            memory_kv.set(CONFIG_KEY, { mode: 120 }) :
            Promise.resolve()
          )
        );
      case 2: return clean_rare(isRareKey_a)
        .then(() => memory_kv.count())
        .then(count => count > memory_kv.capacity() * THRESHOLD ?
          memory_kv.set(CONFIG_KEY, { mode: 223 }) : 
          memory_google_sheet.count().then(count2 => count + count2 < memory_kv.capacity() * THRESHOLD ?
            memory_kv.set(CONFIG_KEY, { mode: 221 }) :
            Promise.resolve()
          )
        );
      case 3: return clean_rare(isRareKey_b)
        .then(() => memory_kv.count())
        .then(count => count > memory_kv.capacity() * THRESHOLD ?
          memory_kv.set(CONFIG_KEY, { mode: 324 }) : 
          memory_google_sheet.count().then(count2 => count + count2 < memory_kv.capacity() * THRESHOLD ?
            memory_kv.set(CONFIG_KEY, { mode: 322 }) :
            Promise.resolve()
          )
        );
      case 4: return clean_rare(isRareKey_c)
        .then(() => memory_kv.count())
        .then(count => count > memory_kv.capacity() * THRESHOLD ?
          memory_kv.set(CONFIG_KEY, { mode: 425 }) : 
          memory_google_sheet.count().then(count2 => count + count2 < memory_kv.capacity() * THRESHOLD ?
            memory_kv.set(CONFIG_KEY, { mode: 423 }) :
            Promise.resolve()
          )
        );
      case 5: return clean_rare(isRareKey_d)
        .then(() => memory_kv.count())
        .then(count => count > memory_kv.capacity() * THRESHOLD ?
          memory_kv.set(CONFIG_KEY, { mode: 526 }) : 
          memory_google_sheet.count().then(count2 => count + count2 < memory_kv.capacity() * THRESHOLD ?
            memory_kv.set(CONFIG_KEY, { mode: 524 }) :
            Promise.resolve()
          )
        );
      case 6: return clean_rare(isRareKey_e)
        .then(() => memory_kv.count())
        .then(count => count > memory_kv.capacity() * THRESHOLD ?
          memory_kv.set(CONFIG_KEY, { mode: 627 }) : 
          memory_google_sheet.count().then(count2 => count + count2 < memory_kv.capacity() * THRESHOLD ?
            memory_kv.set(CONFIG_KEY, { mode: 625 }) :
            Promise.resolve()
          )
        );
      case 7: return clean_gs()
        .then(() => memory_google_sheet.count())
        .then(count => count < memory_kv.capacity() * THRESHOLD ?
          memory_kv.set(CONFIG_KEY, { mode: 726 }) :
          Promise.resolve()
        );
      case 021: return migrate_null_to_kv().then(() => memory_kv.set(CONFIG_KEY, { mode: 1 }));
      case 120: return migrate_kv_to_null().then(() => memory_kv.set(CONFIG_KEY, { mode: 0 }));
      case 122: return migrate_kv_to_rare(isRareKey_a).then(() => memory_kv.set(CONFIG_KEY, { mode: 2 }));
      case 221: return migrate_rare_to_kv().then(() => memory_kv.set(CONFIG_KEY, { mode: 1 }));
      case 223: return migrate_rare_to_rare_up(isRareKey_b).then(() => memory_kv.set(CONFIG_KEY, { mode: 3 }));
      case 322: return migrate_rare_to_rare_down(isRareKey_a).then(() => memory_kv.set(CONFIG_KEY, { mode: 2 }));
      case 324: return migrate_rare_to_rare_up(isRareKey_c).then(() => memory_kv.set(CONFIG_KEY, { mode: 4 }));
      case 423: return migrate_rare_to_rare_down(isRareKey_b).then(() => memory_kv.set(CONFIG_KEY, { mode: 3 }));
      case 425: return migrate_rare_to_rare_up(isRareKey_d).then(() => memory_kv.set(CONFIG_KEY, { mode: 5 }));
      case 524: return migrate_rare_to_rare_down(isRareKey_c).then(() => memory_kv.set(CONFIG_KEY, { mode: 4 }));
      case 526: return migrate_rare_to_rare_up(isRareKey_e).then(() => memory_kv.set(CONFIG_KEY, { mode: 6 }));
      case 625: return migrate_rare_to_rare_down(isRareKey_d).then(() => memory_kv.set(CONFIG_KEY, { mode: 5 }));
      case 627: return migrate_rare_to_gs().then(() => memory_kv.set(CONFIG_KEY, { mode: 7 }));
      case 726: return migrate_gs_to_rare(isRareKey_e).then(() => memory_kv.set(CONFIG_KEY, { mode: 6 }));
      default: throw new Error("Unsupported mode: " + mode);
    }
  }).finally(() => span.end());
}

async function get(key, backup) {
  let mode = (await config()).mode;
  let span = tracer.startSpan('autocode.memory.get');
  span.setAttribute('autocode.memory.key', key);
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
    switch(mode) {
      case 0: return get_null(key, backup);
      case 1: return get_kv(key, backup);
      case 2: return get_rare(isRareKey_a, key, backup);
      case 3: return get_rare(isRareKey_b, key, backup);
      case 4: return get_rare(isRareKey_c, key, backup);
      case 5: return get_rare(isRareKey_d, key, backup);
      case 6: return get_rare(isRareKey_e, key, backup);
      case 7: return get_gs(key, backup);
      case 021: return get_null(key, backup).then(b => get_kv(key, b));
      case 120: return get_kv(key, backup).then(b => get_null(key, b));
      case 122: return get_kv(key, backup).then(b => get_rare(isRareKey_a, key, b));
      case 221: return get_rare(isRareKey_a, key, backup).then(b => get_kv(key, b));
      case 223: return get_rare(isRareKey_a, key, backup).then(b => get_rare(isRareKey_b, key, b));
      case 322: return get_rare(isRareKey_b, key, backup).then(b => get_rare(isRareKey_a, key, b));
      case 324: return get_rare(isRareKey_b, key, backup).then(b => get_rare(isRareKey_c, key, b));
      case 423: return get_rare(isRareKey_c, key, backup).then(b => get_rare(isRareKey_b, key, b));
      case 425: return get_rare(isRareKey_c, key, backup).then(b => get_rare(isRareKey_d, key, b));
      case 524: return get_rare(isRareKey_d, key, backup).then(b => get_rare(isRareKey_c, key, b));
      case 526: return get_rare(isRareKey_d, key, backup).then(b => get_rare(isRareKey_e, key, b));
      case 625: return get_rare(isRareKey_e, key, backup).then(b => get_rare(isRareKey_d, key, b));
      case 627: return get_rare(isRareKey_e, key, backup).then(b => get_gs(key, b));
      case 726: return get_gs(key, backup).then(b => get_rare(isRareKey_e, key, b));
      default: throw new Error("Unsupported mode: " + mode);
    }
  }).finally(() => span.end());
}

function distinct(entries) {
  let cache = new Set();
  let result = [];
  for (let entry of entries) {
    if (cache.has(entry.key)) continue;
    cache.add(entry.key);
    result.push(entry);
  }
  return result;
}

async function list(keys) {
  let mode = (await config()).mode;
  let span = tracer.startSpan('autocode.memory.list');
  span.setAttribute('autocode.memory.keys', keys ? keys.join(', ') : undefined);
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
    switch(mode) {
      case 0: return list_null(keys);
      case 1: return list_kv(keys);
      case 2: return list_rare(isRareKey_a, keys);
      case 3: return list_rare(isRareKey_b, keys);
      case 4: return list_rare(isRareKey_c, keys);
      case 5: return list_rare(isRareKey_d, keys);
      case 6: return list_rare(isRareKey_e, keys);
      case 7: return list_gs(keys);
      case 021: return Promise.all([ list_kv(keys), list_null(keys) ])
        .then(lists => lists[0].concat(lists[1]))
        .then(distinct);
      case 120: return Promise.all([ list_null(keys), list_kv(keys) ])
        .then(lists => lists[0].concat(lists[1]))
        .then(distinct);
      case 122: return Promise.all([ list_rare(isRareKey_a, keys), list_kv(keys) ])
        .then(lists => lists[0].concat(lists[1]))
        .then(distinct);
      case 221: return Promise.all([ list_kv(keys), list_rare(isRareKey_a, keys) ])
        .then(lists => lists[0].concat(lists[1]))
        .then(distinct);
      case 223: return Promise.all([ list_rare(isRareKey_b, keys), list_rare(isRareKey_a, keys) ])
        .then(lists => lists[0].concat(lists[1]))
        .then(distinct);
      case 322: return Promise.all([ list_rare(isRareKey_a, keys), list_rare(isRareKey_b, keys) ])
        .then(lists => lists[0].concat(lists[1]))
        .then(distinct);
      case 324: return Promise.all([ list_rare(isRareKey_c, keys), list_rare(isRareKey_b, keys) ])
        .then(lists => lists[0].concat(lists[1]))
        .then(distinct);
      case 423: return Promise.all([ list_rare(isRareKey_b, keys), list_rare(isRareKey_c, keys) ])
        .then(lists => lists[0].concat(lists[1]))
        .then(distinct);
      case 425: return Promise.all([ list_rare(isRareKey_d, keys), list_rare(isRareKey_c, keys) ])
        .then(lists => lists[0].concat(lists[1]))
        .then(distinct);
      case 524: return Promise.all([ list_rare(isRareKey_c, keys), list_rare(isRareKey_d, keys) ])
        .then(lists => lists[0].concat(lists[1]))
        .then(distinct);
      case 526: return Promise.all([ list_rare(isRareKey_e, keys), list_rare(isRareKey_d, keys) ])
        .then(lists => lists[0].concat(lists[1]))
        .then(distinct);
      case 625: return Promise.all([ list_rare(isRareKey_d, keys), list_rare(isRareKey_e, keys) ])
        .then(lists => lists[0].concat(lists[1]))
        .then(distinct);
      case 627: return Promise.all([ list_gs(keys), list_rare(isRareKey_e, keys) ])
        .then(lists => lists[0].concat(lists[1]))
        .then(distinct);
      case 726: return Promise.all([ list_rare(isRareKey_e, keys), list_gs(keys) ])
        .then(lists => lists[0].concat(lists[1]))
        .then(distinct);
      default: throw new Error("Unsupported mode: " + mode);
    }
  }).finally(() => span.end());
}

async function set(key, value, ttl) {
  let mode = (await config()).mode;
  let span = tracer.startSpan('autocode.memory.set');
  span.setAttribute('autocode.memory.key', key);
  span.setAttribute('autocode.memory.value', value);
  span.setAttribute('autocode.memory.ttl', ttl);
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
    switch(mode) {
      case 0: return set_null(key, value, ttl);
      case 1: return set_kv(key, value, ttl);
      case 2: return set_rare(isRareKey_a, key, value, ttl);
      case 3: return set_rare(isRareKey_b, key, value, ttl);
      case 4: return set_rare(isRareKey_c, key, value, ttl);
      case 5: return set_rare(isRareKey_d, key, value, ttl);
      case 6: return set_rare(isRareKey_e, key, value, ttl);
      case 7: return set_gs(key, value, ttl);
      case 021: return Promise.all([ set_kv(key, value, ttl), set_null(key, value, ttl) ]);
      case 120: return Promise.all([ set_null(key, value, ttl), set_kv(key, value, ttl) ]);
      case 122: return Promise.all([ set_rare(isRareKey_a, key, value, ttl), set_kv(key, value, ttl) ]);
      case 221: return Promise.all([ set_kv(key, value, ttl), set_rare(isRareKey_a, key, value, ttl) ]);
      case 223: return Promise.all([ set_rare(isRareKey_b, key, value, ttl), set_rare(isRareKey_a, key, value, ttl) ]);
      case 322: return Promise.all([ set_rare(isRareKey_a, key, value, ttl), set_rare(isRareKey_b, key, value, ttl) ]);
      case 324: return Promise.all([ set_rare(isRareKey_c, key, value, ttl), set_rare(isRareKey_b, key, value, ttl) ]);
      case 423: return Promise.all([ set_rare(isRareKey_b, key, value, ttl), set_rare(isRareKey_c, key, value, ttl) ]);
      case 425: return Promise.all([ set_rare(isRareKey_d, key, value, ttl), set_rare(isRareKey_c, key, value, ttl) ]);
      case 524: return Promise.all([ set_rare(isRareKey_c, key, value, ttl), set_rare(isRareKey_d, key, value, ttl) ]);
      case 526: return Promise.all([ set_rare(isRareKey_e, key, value, ttl), set_rare(isRareKey_d, key, value, ttl) ]);
      case 625: return Promise.all([ set_rare(isRareKey_d, key, value, ttl), set_rare(isRareKey_e, key, value, ttl) ]);
      case 627: return Promise.all([ set_gs(key, value, ttl), set_rare(isRareKey_e, key, value, ttl) ]);
      case 726: return Promise.all([ set_rare(isRareKey_e, key, value, ttl), set_gs(key, value, ttl) ]);
      default: throw new Error("Unsupported mode: " + mode);
    }
  }).finally(() => span.end());
}

async function fill(entries) {
  let mode = (await config()).mode;
  let span = tracer.startSpan('autocode.memory.fill');
  span.setAttribute('autocode.memory.entries', entries.map(entry => '' + entry.key + '=' + entry.value + ' (ttl=' + entry.ttl + ')').join(', '));
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
    switch(mode) {
      case 0: return fill_null(entries);
      case 1: return fill_kv(entries);
      case 2: return fill_rare(isRareKey_a, entries);
      case 3: return fill_rare(isRareKey_b, entries);
      case 0: return fill_rare(isRareKey_c, entries);
      case 1: return fill_rare(isRareKey_d, entries);
      case 2: return fill_rare(isRareKey_e, entries);
      case 3: return fill_gs(entries);
      case 021: return Promise.all([ fill_kv(entries), fill_null(entries) ]);
      case 120: return Promise.all([ fill_null(entries), fill_kv(entries) ]);
      case 122: return Promise.all([ fill_rare(isRareKey_a, entries), fill_kv(entries) ]);
      case 221: return Promise.all([ fill_kv(entries), fill_rare(isRareKey_a, entries) ]);
      case 223: return Promise.all([ fill_rare(isRareKey_b, entries), fill_rare(isRareKey_a, entries) ]);
      case 322: return Promise.all([ fill_rare(isRareKey_a, entries), fill_rare(isRareKey_b, entries) ]);
      case 324: return Promise.all([ fill_rare(isRareKey_c, entries), fill_rare(isRareKey_b, entries) ]);
      case 423: return Promise.all([ fill_rare(isRareKey_b, entries), fill_rare(isRareKey_c, entries) ]);
      case 425: return Promise.all([ fill_rare(isRareKey_d, entries), fill_rare(isRareKey_c, entries) ]);
      case 524: return Promise.all([ fill_rare(isRareKey_c, entries), fill_rare(isRareKey_d, entries) ]);
      case 526: return Promise.all([ fill_rare(isRareKey_e, entries), fill_rare(isRareKey_d, entries) ]);
      case 625: return Promise.all([ fill_rare(isRareKey_d, entries), fill_rare(isRareKey_e, entries) ]);
      case 627: return Promise.all([ fill_gs(entries), fill_rare(isRareKey_e, entries) ]);
      case 726: return Promise.all([ fill_rare(isRareKey_e, entries), fill_gs(entries) ]);
      default: throw new Error("Unsupported mode: " + mode);
    }
  }).finally(() => span.end());
}

async function unset(key) {
  let mode = (await config()).mode;
  let span = tracer.startSpan('autocode.memory.unset');
  span.setAttribute('autocode.memory.key', key);
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
    switch(mode) {
      case 0: return unset_null(key);
      case 1: return unset_kv(key);
      case 2: return unset_rare(isRareKey_a, key);
      case 3: return unset_rare(isRareKey_b, key);
      case 4: return unset_rare(isRareKey_c, key);
      case 5: return unset_rare(isRareKey_d, key);
      case 6: return unset_rare(isRareKey_e, key);
      case 7: return unset_gs(key);
      case 021: return Promise.all([ unset_kv(key), unset_null(key) ]);
      case 120: return Promise.all([ unset_null(key), unset_kv(key) ]);
      case 122: return Promise.all([ unset_rare(isRareKey_a, key), unset_kv(key) ]);
      case 221: return Promise.all([ unset_kv(key), unset_rare(isRareKey_a, key) ]);
      case 223: return Promise.all([ unset_rare(isRareKey_b, key), unset_rare(isRareKey_a, key) ]);
      case 322: return Promise.all([ unset_rare(isRareKey_a, key), unset_rare(isRareKey_b, key) ]);
      case 324: return Promise.all([ unset_rare(isRareKey_c, key), unset_rare(isRareKey_b, key) ]);
      case 423: return Promise.all([ unset_rare(isRareKey_b, key), unset_rare(isRareKey_c, key) ]);
      case 425: return Promise.all([ unset_rare(isRareKey_d, key), unset_rare(isRareKey_c, key) ]);
      case 524: return Promise.all([ unset_rare(isRareKey_c, key), unset_rare(isRareKey_d, key) ]);
      case 526: return Promise.all([ unset_rare(isRareKey_e, key), unset_rare(isRareKey_d, key) ]);
      case 625: return Promise.all([ unset_rare(isRareKey_d, key), unset_rare(isRareKey_e, key) ]);
      case 627: return Promise.all([ unset_gs(key), unset_rare(isRareKey_e, key) ]);
      case 726: return Promise.all([ unset_rare(isRareKey_e, key), unset_gs(key) ]);
      default: throw new Error("Unsupported mode: " + mode);
    }
  }).finally(() => span.end());
}

async function clear(keys) {
  if (!keys) throw new Error('This is a safety net. It would result in dumping all memory!');
  let mode = (await config()).mode;
  let span = tracer.startSpan('autocode.memory.clear');
  span.setAttribute('autocode.memory.keys', keys ? keys.join(', ') : undefined);
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
    switch(mode) {
      case 0: return clear_null(keys);
      case 1: return clear_kv(keys);
      case 2: return clear_rare(isRareKey_a, keys);
      case 3: return clear_rare(isRareKey_b, keys);
      case 4: return clear_rare(isRareKey_c, keys);
      case 5: return clear_rare(isRareKey_d, keys);
      case 6: return clear_rare(isRareKey_e, keys);
      case 7: return clear_gs(keys);
      case 021: return Promise.all([ clear_kv(keys), clear_null(keys) ]);
      case 120: return Promise.all([ clear_null(keys), clear_kv(keys) ]);
      case 122: return Promise.all([ clear_rare(isRareKey_a, keys), clear_kv(keys) ]);
      case 221: return Promise.all([ clear_kv(keys), clear_rare(isRareKey_a, keys) ]);
      case 223: return Promise.all([ clear_rare(isRareKey_b, keys), clear_rare(isRareKey_a, keys) ]);
      case 322: return Promise.all([ clear_rare(isRareKey_a, keys), clear_rare(isRareKey_b, keys) ]);
      case 324: return Promise.all([ clear_rare(isRareKey_c, keys), clear_rare(isRareKey_b, keys) ]);
      case 423: return Promise.all([ clear_rare(isRareKey_b, keys), clear_rare(isRareKey_c, keys) ]);
      case 425: return Promise.all([ clear_rare(isRareKey_d, keys), clear_rare(isRareKey_c, keys) ]);
      case 524: return Promise.all([ clear_rare(isRareKey_c, keys), clear_rare(isRareKey_d, keys) ]);
      case 526: return Promise.all([ clear_rare(isRareKey_e, keys), clear_rare(isRareKey_d, keys) ]);
      case 625: return Promise.all([ clear_rare(isRareKey_d, keys), clear_rare(isRareKey_e, keys) ]);
      case 627: return Promise.all([ clear_gs(keys), clear_rare(isRareKey_e, keys) ]);
      case 726: return Promise.all([ clear_rare(isRareKey_e, keys), clear_gs(keys) ]);
      default: throw new Error("Unsupported mode: " + mode);
    }
  }).finally(() => span.end());
}

async function consume(key, backup) {
  // return get(key, backup).then(value => unset(key).then(() => value));
  return list([ key ]).then(entries => entries.length == 0 ? backup : unset(entries[0].key).then(() => entries[0].value));
}

function entry(key, value, ttl) {
  return { key: key, value: value, ttl: ttl };
}

function putInDictionary(dictionary, id, name) {
  if (dictionary[id]) {
    if (!dictionary[id].includes(name)) dictionary[id] = dictionary[id] + '/' + name;
  } else {
    dictionary[id] = name;
  }
}

async function fillDictionaryWithGuildChannels(dictionary, guild) {
  return discord.guild_channels_list(guild.id)
    .then(channels => channels.map(channel => putInDictionary(dictionary, channel.id, channel.name)));
}

async function fillDictionaryWithGuildMembers(dictionary, guild) {
  return discord.guild_members_list(guild.id)
    .then(members => members.map(member => {
      putInDictionary(dictionary, member.user.id, member.user.username + '#' + member.user.discriminator);
      if (member.nick) {
        putInDictionary(dictionary, member.user.id, member.nick);
      }
    }));
}

async function fillDictionaryWithGuildRoles(dictionary, guild) {
  return discord.guild_roles_list(guild.id)
    .then(roles => roles.map(role => putInDictionary(dictionary, role.id, role.name)));
}

async function fillDictionaryWithGuild(dictionary, guild) {
  return Promise.all([
    putInDictionary(dictionary, guild.id, guild.name),
    fillDictionaryWithGuildChannels(dictionary, guild),
    fillDictionaryWithGuildMembers(dictionary, guild),
    fillDictionaryWithGuildRoles(dictionary, guild),
  ]);
}

async function getDictionary() {
  let dictionary = {};
  await discord.guilds_list().then(guilds => Promise.all(guilds.map(guild => fillDictionaryWithGuild(dictionary, guild))));
  return dictionary;
}

async function toString(resolve, includes = [], excludes = []) {
  let dictionary = resolve ? (await getDictionary()) : {};
  let entries = await list();
  let count = 0;
  let result = '';
  for (let index = 0; index < entries.length; index++) {
    let entry = entries[index];
    let key = entry.key;
    let value;
    if (('' + entry.value).includes('[object Object]')) {
      value = JSON.stringify(entry.value);
    } else {
      value = '' + entry.value;
    }
    for (let id in dictionary) {
      let resolved = `${dictionary[id]}-${id}`;
      key = key.replace(id, resolved);
      value = value.replace(id, resolved);
    }
    let line = `${key}=${value}`;
    if (includes.every(include => line.includes(include)) && excludes.every(exclude => !line.includes(exclude))) {
      result += `\n${line}`;
      count++;
    }
  }
  return `[${count}]${result}`;
}

function mask(string) {
  return [
      hash(string, 7, 13),
      hash(string, 109, 59),
      hash(string, 37, 101),
      hash(string, 31, 89)
    ]
    .map(hash => Math.abs(hash))
    .map(hash => (hash).toString(16))
    .join('-');
}

function hash(string, p1, p2) {
  let hash = p1;
  for (let i = 0; i < string.length; i++) {
    hash = (hash * p2 + string.charCodeAt(i)) & 0xFFFFFFFF;
  }
  return hash;
}

module.exports = { clean, get, list, set, fill, unset, clear, entry, consume, toString, mask }
