const lib = require('lib')({token: process.env.STDLIB_SECRET_TOKEN});
const r = require('./retry.js');
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode.googlesheet');

const range = 'A1:E1000000';
const limit = { 'count': 1000, 'offset': 0 };

async function get(key, backup) {
  return list([ key ]).then(rows => rows.length > 0 ? rows[0].value : backup);
}

async function list(keys) {
  return select_multi(keys ? keys.map(key => { return { key: key }; }) : [{}])
    // there may be expired and even multiple entries (see set/fill)
    .then(rows => Array.from(new Set(rows.map(row => row.key)))
      .map(key => rows
        .filter(row => row.key === key)
        .reduce((e1, e2) => e1 && e2 ? (e1.timestamp >= e2.timestamp ? e1 : e2) : (e1 ? e1 : e2), null)
      )
    )
    .then(rows => rows.filter(row => !isExpired(row)));
}

async function set(key, value, ttl) {
  // two callers may race, causing two rows being added, we solve that on read
  // in theory we could do the same as the fill call, should we? in some cases we would save a call
  //   can we optimize that case maybe by caching keys that we already saw? to run update on them, and if not just insert
  // also, to save on per minute quota, we could just always insert ...
  let entry = { key: key, value: value, ttl: ttl };
  if (typeof value === 'number' && (await update_multi({ key: key }, entry)) > 0) {
    // reasoning here being, if its a number, there is a good chance its a counter and therefore already exists
    // so always inserting would explode the sheet
    return Promise.resolve();
  }
  return fill([ entry ]);
}

async function fill(entries) {
  // in theory we should do here what set does, try to update a bunch of rows, insert the rest.
  // for simplicity, just add new entries, let the next clean cycle remove the old ones ...
  return insert_multi(entries);
}

async function unset(key) {
  return clear([ key ]);
}

async function clear(keys) {
  if (keys && isMultiSelectPending()) {
    keys = await list(keys).then(entries => entries.map(entry => entry.key)).then(existing => keys.filter(key => existing.includes(key)));
  } else if (!keys) {
    keys = await list().then(entries => entries.map(entry => entry.key));
  }
  return delete_multi(keys.map(key => { return { key: key }; }));
}

async function clean() {
  return /* delete_multi([{ valid_until: Date.now(), '$comparison_valid_until': 'lt' }]) */ Promise.resolve()
    .then(() => select_multi())
    .then(rows => {
      let newsts = Array.from(new Set(rows.map(row => row.key)))
        .map(key => rows
          .filter(row => row.key === key)
          .reduce((e1, e2) => e1 && e2 ? (e1.timestamp >= e2.timestamp ? e1 : e2) : (e1 ? e1 : e2), null)
        );
      //TODO if two entries for same key have same timestamp, we will delete both
      return delete_multi(rows.filter(row => isExpired(row) || !newsts.some(neew => neew.key === row.key && neew.timestamp === row.timestamp)));
    });
}

function isExpired(row) {
  return row.ttl && row.timestamp + row.ttl * 1000 < Date.now();
}

async function retry(operation) {
  return r.retry(operation, e => e.message.includes("Quota exceeded") || e.message.includes('Execution timeout') || e.message.includes('Function timeout') || e.message.includes('Unspecified error running remote Standard Library function'));
}

async function count() {
  console.log('gs:count');
  let span = tracer.startSpan('autocode.googlesheet.count');
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => 
    retry(() => lib.googlesheets.query['@0.3.0'].count({
      range: range,
      where: [{ key__not: ''}],
      bounds: 'FULL_RANGE',
    })).then(result => result.count)
  ).finally(() => span.end());
}

async function select(descriptions) {
  let rows = [];
  let again = false;
  do {
    let page = await select_paged(descriptions, rows.length);
    rows = rows.concat(page);
    again = page.length == limit.count;
  } while (again);
  return rows.filter(row => row.key && row.key.length > 0).map(row => {
    return { key: row.key, value: unstringify(row.value, row.type, row.key), ttl: row.ttl ? parseInt(row.ttl) : undefined, timestamp: parseInt(row.timestamp) };
  });
}

async function select_paged(descriptions, offset) {
  console.log(`gs:select where ` + descriptions.map(description => JSON.stringify(createWhere(description))).join(' OR ') + ` offset=${offset}`);
  let span = tracer.startSpan('autocode.googlesheet.select');
  span.setAttribute('autocode.googlesheet.where', descriptions.map(description => JSON.stringify(createWhere(description))).join(' OR '));
  span.setAttribute('autocode.googlesheet.offset', offset);
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => 
    retry(() => lib.googlesheets.query['@0.3.0'].select({
      range: range,
      bounds: 'FULL_RANGE',
      where: descriptions.some(descr => JSON.stringify(descr) === '{}') ? [{ key__not: '' }] : descriptions.map(description => createWhere(description)),
      limit: { count: limit.count, offset: offset }
    })).then(result => result.rows.map(row => row.fields))
  ).finally(() => span.end());
}

async function insert(entries) {
  console.log(`gs:insert ` + entries.map(entry => `key=${entry.key}, value=${entry.value}, ttl=${entry.ttl}`).join(', '));
  let span = tracer.startSpan('autocode.googlesheet.insert');
  span.setAttribute('autocode.googlesheet.entries',  entries.map(entry => `key=${entry.key}, value=${entry.value}, ttl=${entry.ttl}`).join(', '));
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => 
    entries.length == 0 ? Promise.resolve() : retry(() => lib.googlesheets.query['@0.3.0'].insert({
      range: range,
      fieldsets: entries.map(entry => createFields(entry.key, entry.value, entry.ttl, entry.timestamp))
    })).then(result => result.updatedRows)
  ).finally(() => span.end());
}

async function delete_(descriptions) {
  console.log(`gs:delete where ` + descriptions.map(description => JSON.stringify(createWhere(description))).join(' OR '));
  let span = tracer.startSpan('autocode.googlesheet.delete');
  span.setAttribute('autocode.googlesheet.where', JSON.stringify(descriptions.map(description => JSON.stringify(createWhere(description))).join(' OR ')));
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => 
    descriptions.length == 0 ? Promise.resolve() : retry(() => lib.googlesheets.query['@0.3.0'].delete({
      range: range,
      bounds: 'FULL_RANGE',
      where: descriptions.map(description => createWhere(description)),
      limit: limit
    })).then(result => undefined)
  ).finally(() => span.end());
}

async function update(description, entry) {
  console.log(`gs:update key=${entry.key}, value=${entry.value}, ttl=${entry.ttl} where ` + JSON.stringify(createWhere(description)));
  let span = tracer.startSpan('autocode.googlesheet.update');
  span.setAttribute('autocode.googlesheet.where', JSON.stringify(createWhere(description)));
  span.setAttribute('autocode.googlesheet.entries', `key=${entry.key}, value=${entry.value}, ttl=${entry.ttl}`);
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => 
    retry(() => lib.googlesheets.query['@0.3.0'].update({
      range: range,
      bounds: 'FULL_RANGE',
      where: [ createWhere(description) ],
      limit: { count: 1, offset: limit.offset }, // it is important to only update 1, not all, otherwise the clean operation will delete all
      fields: createFields(entry.key, entry.value, entry.ttl)
    })).then(result => result.rows.length)
  ).finally(() => span.end());
}

function createWhere(description) {
  let and = {};
  for (let field in description) {
    if (field.startsWith('$comparison_')) continue; 
    let operation = description[`$comparison_${field}`] ?? 'is';
    and[`${field}__${operation}`] = stringify(description[field]);
  }
  return and;
}

function createFields(key, value, ttl, timestamp = undefined) {
  return {
    'key': stringify(key),
    'type': stringify(typeof value),
    'value': stringify(value),
    'ttl': stringify(ttl),
    'timestamp': stringify(timestamp ?? Date.now())
  };
}

function stringify(value) {
  switch (typeof value) {
    case undefined: return undefined;
    case 'undefined': return undefined;
    case 'string': return value;
    case 'object': return JSON.stringify(value);
    case 'number': return '' + value;
    case 'boolean': return value ? 'TRUE' : 'FALSE'; // google sheets autocorrect any entry of 'true' or 'false' to 'TRUE' and 'FALSE' respectively
    default: throw "Unknown type " + typeof value;
  }
}

function unstringify(value, type, key) {
  switch(type) {
    case undefined: return undefined;
    case 'undefined': return undefined;
    case '': return undefined;
    case 'string': return value;
    case 'object': return JSON.parse(value);
    case 'number': return Number(value);
    case 'boolean': return value === 'TRUE';
    default: throw "Unknown type " + type + " for value " + value + " and key " + key;
  }
}

async function multi(operation, parameters, context, merge_parameters, reduce_result) {
  while (context.promise) await r.delay(10);
  let master = context.count == 0;
  context.time = master ? (Date.now() + 2500) : Math.max(context.time, Date.now() + 1000);
  context.count++;
  context.parameters = merge_parameters(context.parameters, parameters);
  
  if (master) {
    while (Date.now() < context.time) await r.delay(10);
    context.promise = Promise.resolve()
      .then(() => operation(context.parameters))
      .then(result => context.result = result)
      .catch(error => context.error = error)
      .finally(() => context.done = true);
    await context.promise;
    while (context.count > 1) await r.delay(10);
  } else {
    while (!context.done) await r.delay(10);
  }
  
  let result = context.result;
  let error = context.error;
  context.count--;
  if (master) {
    context.time = 0;
    context.count = 0;
    context.parameters = [];
    context.promise = null;
    context.done = false;
    context.result = null;
    context.error = null;
  }
  if (error) throw error;
  return reduce_result(parameters, result);
}

var select_context = {
  time: 0,
  count: 0,
  parameters: [],
  promise : null,
  done: false,
  results: null,
  error: null
};

const select_reduce_result = (parameters, result) => result.filter(row => {
  if (!parameters) return true;
  for (let parameter of parameters) {
    let match = true;
    for (let field in parameter) {
      match = match && parameter[field] === row[field];
    }
    if (match) return true;
  }
  return false;
});

async function select_multi(descriptions, exact) {
  return multi(select, descriptions, select_context, (p1, p2) => p1.concat(p2), select_reduce_result);
}

var insert_context = {
  time: 0,
  count: 0,
  parameters: [],
  promise : null,
  done: false,
  results: null,
  error: null
};

async function insert_multi(entries) {
  return multi(insert, entries, insert_context, (p1, p2) => p1.concat(p2), (parameters, result) => result);
}

var delete_context = {
  time: 0,
  count: 0,
  parameters: [],
  promise : null,
  done: false,
  results: null,
  error: null
};

async function delete_multi(keys) {
  return multi(delete_, keys, delete_context, (p1, p2) => p1.concat(p2), (parameters, result) => result);
}

async function update_multi(description, entry) {
  return update(description, entry); // cant multi-merge this since an update can only have one set of field combinations
}

function isMultiSelectPending() {
  return select_context.count > 0;
}

module.exports = { count, get, list, set, fill, unset, clear, clean}
