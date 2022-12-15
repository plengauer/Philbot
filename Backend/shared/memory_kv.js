const lib = require('lib')({token: process.env.STDLIB_SECRET_TOKEN});
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode.keyvalue');
const r = require('./retry.js');
const id = require('./identity.js');

function marshal(key, value, ttl, timestamp) {
  return {
    key: key,
    value: value,
    ttl: ttl,
    timestamp: timestamp ? timestamp : Date.now()
  };
}

function isFatEntry(key, value) {
  // value and also value.value may be undefined / null
  return value && value.key /* && value.value */ && value.timestamp && value.key === key;
}

function unmarshal(key, value) {
  return isFatEntry(key, value) ? value.value : value;
}

function capacity() {
  return 1000; // see doc
}

async function count() {
  return list().then(entries => entries.length);
}

async function get(key, backup) {
  console.log(`kv:get key=${key}`);
  let span = tracer.startSpan('autocode.keyvalue.get');
  span.setAttribute('autocode.keyvalue.key', key);
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => 
    retry(() => lib.utils.kv['@0.1.16'].get({ key: key, defaultValue: backup })).then(value => unmarshal(key, value))
  ).finally(() => span.end());
}

async function list(keys) {
  if (keys && keys.length <= 10) {
    return Promise.all(keys.map(key => get(key, undefined).then(value => { return { key: key, value: value }; })))
      .then(entries => entries.filter(entry => entry.value));
  } else {
    console.log(`kv:list key in ` + keys);
    let span = tracer.startSpan('autocode.keyvalue.list');
    span.setAttribute('autocode.keyvalue.keys', keys ? keys.join(', ') : undefined)
    return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => 
      // max storage size is 1024, just list them all and filter them
      retry(() => lib.utils.kv['@0.1.16'].entries())
        .then(entries => entries.map(entry => {
          let key = entry[0];
          let value = entry[1];
          return {
            key: key,
            value: unmarshal(key, value),
            ttl: isFatEntry(key, value) && value.ttl ? value.ttl : undefined,
            timestamp: isFatEntry(key, value) && value.timestamp && !isNaN(value.timestamp) ? value.timestamp : undefined
          };
        })).then(entries => keys ? entries.filter(entry => keys.includes(entry.key)) : entries)
    ).finally(() => span.end());
  }
}

async function set(key, value, ttl, timestamp) {
  console.log(`kv:set key=${key}, value=${value}, ttl=${ttl}`);
  let span = tracer.startSpan('autocode.keyvalue.set');
  span.setAttribute('autocode.keyvalue.key', key);
  span.setAttribute('autocode.keyvalue.value', value);
  span.setAttribute('autocode.keyvalue.ttl', ttl);
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => 
    retry(() => lib.utils.kv['@0.1.16'].set({
      key: key,
      value: marshal(key, value, ttl, timestamp),
      ttl: (timestamp && ttl) ? Math.max(1, ttl - Math.floor((Date.now() - timestamp) / 1000)) : ttl,
    }))
  ).finally(() => span.end())
  .catch(ex => {
    if (ex.stack.includes('Max key-value pairs reached.')) {
      return get(key, undefined).then(v => v ? unset(key).then(() => set(key, value, ttl, timestamp)) : do_throw(ex));
    } else throw ex;
  });
}

function do_throw(ex) {
  throw ex;
}

async function fill(entries) {
  return Promise.all(entries.map(entry => set(entry.key, entry.value, entry.ttl, entry.timestamp)));
}

async function unset(key) {
  console.log(`kv:clear key=${key}`);
  let span = tracer.startSpan('autocode.keyvalue.clear');
  span.setAttribute('autocode.keyvalue.key', key);
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => 
    retry(() => lib.utils.kv['@0.1.16'].clear({ key: key }))
  ).finally(() => span.end());
}

async function clear(keys) {
  if (keys) {
    return Promise.all(keys.map(key => unset(key)));
  } else {
    console.log(`kv:truncate`);
    let span = tracer.startSpan('autocode.keyvalue.truncate');
    return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => 
      retry(() => lib.utils.kv['@0.1.16'].tables.truncate({ table: id.getAccountName() }))
    ).finally(() => span.end());
  }
}

async function clean() {
  return Promise.resolve();
}

async function retry(operation) {
  return r.retry(operation, e => e.message.includes('Unspecified error running remote Standard Library function'));
}

module.exports = { capacity, count, get, list, set, fill, unset, clear, clean}
