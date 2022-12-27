const http = require('http');
const https = require('https');
const zlib = require('zlib');
const retry = require('./retry.js').retry;
const delay = require('./retry.js').delay;

async function request(options) {
  if (!options.path) options.path = '/'; 
  if (!options.headers || !options.headers['accept']) {
    options.headers = options.headers ?? {};
    options.headers['accept'] = 'application/json';
  }
  if (options.body) {
    options.headers = options.headers ?? {};
    if (typeof options.body == 'object') {
      options.body = JSON.stringify(options.body);
      options.headers['content-type'] = 'application/json';
    } else if (typeof options.body == 'string' && !options.headers['content-type']) {
      options.headers['content-type'] = 'text/plain';
    } else {
      options.body = '' + options.body;
      options.headers['content-type'] = 'text/plain';
    }
  }
  let response = await request_full(options);
  if (200 <= response.status && response.status < 300) return (response.headers['content-type'] && response.headers['content-type'].startsWith('application/json')) ? JSON.parse(response.body) : response.body;
  else throw new Error('HTTP error ' + response.status + ': ' + response.body);
}

async function request_full(options) {
  let stage_4 = options => request_simple(options);
  let stage_3 = options => request_failed(options, stage_4);
  let stage_2 = options => request_rate_limited(options, stage_3);
  let stage_1 = options => request_redirected(options, stage_2);
  let stage_0 = options => request_cached(options, stage_1)
  return stage_0(options);
}

async function request_simple(options) {
  if (!options.hostname) throw new Error('Need hostname');
  if (!options.path) throw new Error('Need path');
  if (!options.path.startsWith('/')) throw new Error('Path must start with a "/"');
  if (options.body && typeof options.body != 'string') throw new Error('Body must be string');
  if (options.body && !options.headers['content-type']) throw new Error('Body must have content-type header');
  if (options.headers && options.headers['authorization'] && options.secure != undefined && !options.secure) throw new Error('Authorization header requires https');

  if (!options.method) options.method = 'GET';
  if (!options.headers) options.headers = {};
  if (!options.timeout) options.timeout = 1000 * 10;
  if (options.secure == undefined) options.secure = true;
  options.headers['accept-encoding'] = 'gzip,identity';
  // content-length is byte-based, not character based, lets end the request explicitly and not do the necessary calculations ...
  // if (options.body) options.headers['content-length'] = options.body.length;

  return retry(() => new Promise((resolve, reject) => {
      let s = options.secure ? 's' : '';
      let time = Date.now();      
      let request = (options.secure ? https : http).request(options, response => {
          let receiver = null;
          if (response.headers['content-encoding'] == 'gzip') {
            receiver = zlib.createGunzip();
            response.pipe(receiver);
          } else {
            receiver = response;
          }
          let buffer = '';
          receiver.on('data', chunk => { buffer += chunk; });
          receiver.on('end', () => {
            let duration = Date.now() - time;
            console.log(`HTTP ${options.method} http${s}://${options.hostname}${options.path} => ${response.statusCode} (${duration}ms)`);
            resolve({ status: response.statusCode, headers: response.headers, body: buffer });
          });
        });
      request.on('error', error => {
          console.log(`HTTP ${options.method} http${s}://${options.hostname}${options.path} => ${error.message}`);
          reject(error);
        });
      request.on('timeout', () => {
          let duration = Date.now() - time;
          console.log(`HTTP ${options.method} http${s}://${options.hostname}${options.path} => TIMEOUT (${duration}ms)`);
          reject(new Error(`HTTP Timeout`));
        });
      if (options.body) {
        request.write(options.body);
      }
      request.end();
    }));
}

async function request_redirected(options, request) {
  return request(options).then(response => {
      if (300 <= response.status && response.status < 400 && response.headers['location']) {
        let location = response.headers['location'];
        if (location.startsWith('http://') || location.startsWith('https://')) {
          options.secure = location.startsWith('https://');
          location = location.substring(location.indexOf('://') + 3);
          options.hostname = location.includes('/') ? location.substring(0, location.indexOf('/')) : location;
          options.path = location.includes('/') ? location.substring(location.indexOf('/'), location.length) : '/';
        } else if (location.startsWith('/')) {
          options.path = location;
        } else {
          return response; // unknown redirect
        }
        return request_redirected(options, request);
      } else return response;
    });
}

async function request_failed(options, request) {
  return retry(() => request(options).then(response => {
      if (500 <= response.status && response.status < 600) throw new Error('HTTP Error ' + response.status);
      else return response;
    }), e => e.message.startsWith('HTTP Error 5'));
}

async function request_rate_limited(options, request) {
  return request_rate_limited_v2(options, request);
}

async function request_rate_limited_v1(options, request) {
  for(;;) {
    let response = await request(options);
    if (response.status == 429) {
      if (response.headers['retry-after'] && !isNaN(response.headers['retry-after'])) {
        await delay(parseInt(reason.headers['retry-after']) * 1000);
      } else {
        await delay(1000);
      }
      continue;
    }
    return response;
  }
}

var rate_limits = {};
var active_counts = {};

async function request_rate_limited_v2(options, request) {
  if (!options.hostname) throw new Error("Need hostname");
  if (!options.path) throw new Error("Need path");

  let cpath = options.rate_limit_hint?.strip_digits ? options.path.split('/').filter(segment => !/\d/.test(segment)).join('/') : options.path;

  // we need to update the feedback from the other side and keep our own count because
  // (1) the server side knows about requests that we dont and (2) sending many requests
  // in parallel may result in us violating the rate limit quite drastically
  // with this approach, worst case the server side responds with already counted requests
  // that are still active on our end when we check. so in these extreme case, this algorithm
  // only uses half the rate limit. if we send requests very fast, we tend to me more at the
  // rate limit because we send many before getting the first feedback.
  
  // clear old rate limits to make sure we dont have a memory leak
  Object.keys(rate_limits)
    .filter(bucket => active_counts[bucket] == 0 && rate_limits[bucket].every(rl => Date.now() > rl.timestamp + 10 * rl.length * 1000))
    .forEach(bucket => { rate_limits[bucket] = undefined; active_counts[bucket] = undefined; });
  
  // check if there is a rate limit, and if not create a fake one to make canary request. that rate limit will be overridden after the first requests
  if (!rate_limits[options.hostname] || rate_limits[options.hostname].length == 0) rate_limits[options.hostname] = [ create_rate_limit(1, 1, 0, true) ];
  if (!rate_limits[options.hostname + cpath] || rate_limits[options.hostname + cpath].length == 0) rate_limits[options.hostname + cpath] = [ create_rate_limit(1, 1, 0, true) ];
  if (!active_counts[options.hostname]) active_counts[options.hostname] = 0;
  if (!active_counts[options.hostname + cpath]) active_counts[options.hostname + cpath] = 0;
  
  for(;;) {
    // check and reset slotting of all rate limits
    rate_limits[options.hostname].concat(rate_limits[options.hostname + cpath])
      .filter(rl => Date.now() > rl.timestamp + rl.length * 1000 || (rl.next && Date.now() > rl.timestamp + rl.next * 1000))
      .forEach(rl => { rl.count = 0; rl.timestamp = Date.now() });
    
    // check if any of the rate limits have been hit, if so, wait the appropriate amount of time and restart
    let rate_limits_hit_host = rate_limits[options.hostname].filter(rl => rl.count + active_counts[options.hostname] >= rl.max);
    let rate_limits_hit_path = rate_limits[options.hostname + cpath].filter(rl => rl.count + active_counts[options.hostname + cpath] >= rl.max);
    if (rate_limits_hit_host.length + rate_limits_hit_path.length > 0) {
      await delay(rate_limits_hit_host.concat(rate_limits_hit_path).map(rl => rl.next ? Math.min(rl.next, rl.length) : rl.length).reduce((l1, l2) => Math.max(l1, l2), 0) * 1000);
      continue;
    }
    
    // execute the request
    let response = null;
    try {
      active_counts[options.hostname]++;
      active_counts[options.hostname + cpath]++;
      response = await request(options);
    } finally {
      active_counts[options.hostname]--;
      active_counts[options.hostname + cpath]--;
    }
    
    // check for rate limit headers and parse them. if there are none, create fake rate limits
    if (response.headers['x-app-rate-limit'] && response.headers['x-method-rate-limit']) {
      // "x-app-rate-limit":"20:1,100:120","x-app-rate-limit-count":"43:1,20:120"
      // "x-method-rate-limit":"250:10","x-method-rate-limit-count":"40:10"
      rate_limits[options.hostname] = parse_rate_limits_rito_style(response, 'x-app-rate-limit');
      rate_limits[options.hostname + cpath] = parse_rate_limits_rito_style(response, 'x-method-rate-limit');
    } else if (response.headers['x-ratelimit-limit'] && response.headers['x-ratelimit-remaining'] && response.headers['x-ratelimit-reset']) {
      // x-ratelimit-limit: 100
      // x-ratelimit-remaining: 97
      // x-ratelimit-reset: 1667205263
      let max = parseInt(response.headers['x-ratelimit-limit']);
      let length = Math.floor(Math.max(1, parseInt(response.headers['x-ratelimit-reset']) - Date.now() / 1000));
      let count = max - parseInt(response.headers['x-ratelimit-remaining']);
      rate_limits[options.hostname] = [ options.rate_limit_hint?.host_scope ? create_rate_limit(max, length, count) : create_rate_limit(options.rate_limit_hint?.max ?? 100, 1, 0, true) ];
      rate_limits[options.hostname + cpath] = [ create_rate_limit(max, length, count) ];
    } else {
      rate_limits[options.hostname] = [ create_rate_limit(options.rate_limit_hint?.max ?? 100, 1, 0, true) ];
      rate_limits[options.hostname + cpath] = [ create_rate_limit(options.rate_limit_hint?.max ?? 100, 1, 0, true) ];
    }
    
    // if the request still was 429, restart the process and give hint about when to retry.
    if (response.status == 429) {
      if (response.headers['retry-after']) {
        let next = parseInt(response.headers['retry-after']);
        rate_limits[options.hostname].filter(rl => rl.count + active_counts[options.hostname] >= rl.max).forEach(rl => rl.next = next);
        rate_limits[options.hostname + cpath].filter(rl => rl.count + active_counts[options.hostname + cpath] >= rl.max).forEach(rl => rl.next = next);
      }
      console.error(`HTTP rate limit hit (${options.hostname}): ` + rate_limits[options.hostname].map(rl => `${rl.count}/${rl.max} (${rl.length},${rl.next})`).join(',')); 
      console.error(`HTTP rate limit hit (${options.hostname}${cpath}): ` + rate_limits[options.hostname + cpath].map(rl => `${rl.count}/${rl.max} (${rl.length},${rl.next})`).join(',')); 
      continue;
    }
    
    return response;
  }
}

function parse_rate_limits_rito_style(response, header) {
  return response.headers[header].split(',')
    .map(string => string.split(':'))
    .map(tokens => create_rate_limit(parseInt(tokens[0]), parseInt(tokens[1]), response.headers[header + '-count'].split(',').map(string2 => string2.split(':')).filter(tokens2 => tokens2[1] == tokens[1]).map(tokens2 => parseInt(tokens2[0])).reduce((a1, a2) => a1 + a2, 0)));
}

function create_rate_limit(max, length, count, fake = false) {
  return {
    timestamp: Date.now(),
    max: max,
    length: length,
    count: count,
    fake: fake
  } 
}

async function request_cached(options, request) {
  // this implementation has two potential problems
  // *) due to the different caching durations, the eviction algorithm will prefer requests with high durations, even if lower duration requests occur more often (simply because they have more time racking up hits)
  // *) cache size is 10Mb, is that acceptible? we may wanna move to a filesystem based cache at some point (memory.js?)
  if (options.cache) {
    let cached = lookup(options);
    if (cached) console.log(`HTTP cache hit (${options.hostname}${options.path})`);
    if (cached) return cached;
  }
  let response = await request(options)
  if (options.cache) remember(options, response);
  return response;
}

const CACHE_SIZE = 1024 * 1024 * 10;
var cache = {};

function lookup(options) {
  // evict all timed out entries
  for (let k of Object.keys(cache).filter(k => cache[k].timestamp + options.cache * 1000 < Date.now())) delete cache[k];
  // lookup
  let entry = cache[cachekey(options)];
  if (!entry) return null;
  entry.hits++;
  return entry.value;
}

function remember(options, response) {
  // is the current response eligable to be cached?
  if (!response.body || response.body.length > CACHE_SIZE) return;
  // make entry
  let key = cachekey(options);
  cache[key] = cache[key] ?? { value: null, hits: 0, timestamp: Date.now() };
  // find entries that this new one would supercede and see if it would be enough to store the new entry
  let to_evict = Object.keys(cache).filter(k => cache[k].value).filter(k => cache[k].hits < cache[key].hits); 
  if (cachesize() + response.body.length > CACHE_SIZE && to_evict.map(k => cache[k].value.length).reduce((l1, l2) => l1 + l2, 0) < response.body.length) return;
  // as long as cache is too big, throw away the one with lowest hits
  while (cachesize() + response.body.length > CACHE_SIZE) {
    let keys = Object.keys(cache).filter(k => to_evict.includes(k));
    if (keys.length == 0) throw new Error('Here be dragons!');
    let lowest = 0;
    for (let i = 1; i < keys.length; i++) {
      lowest = cache[keys[i]].hits < cache[keys[lowest]].hits ? i : lowest;
    }
    cache[keys[lowest]].value = undefined;
  }
  // cache!
  cache[key].value = response;
}

function cachesize() {
  return Object.keys(cache).map(key => cache[key]).filter(entry => entry.value).map(entry => entry.value.body.length).reduce((s1, s2) => s1 + s2, 0);
}

function cachekey(options) {
  return `${options.hostname}${options.path}`; // TODO include headers? or payload?
}

module.exports = { request, request_full, request_simple }
