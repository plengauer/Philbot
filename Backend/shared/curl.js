const https = require('https');
const zlib = require('zlib');
const retry = require('./retry.js').retry;
const delay = require('./retry.js').delay;

async function get(hostname, path, headers = {}) {
  if (!headers['Accept']) headers['Accept'] = 'application/json';
  let response = await get_full(hostname, path, headers);
  if (200 <= response.status && response.status < 300) return (response.headers['content-type'] && response.headers['content-type'].startsWith('application/json')) ? JSON.parse(response.body) : response.body;
  else throw new Error('HTTP error ' + response.status + ': ' + response.body);
}

async function get_full(hostname, path, headers) {
  return get_redirected(hostname, path, headers, (hostname1, path1, headers1) => get_rate_limited(hostname1, path1, headers1, (hostname2, path2, headers2) => get_failed(hostname2, path2, headers2, (hostname3, path3, headers3) => get_simple(hostname3, path3, headers3))));
}

async function get_simple(hostname, path, headers) {
  return retry(() => new Promise((resolve, reject) => {
      let options = {
        hostname: hostname,
        path: path,
        headers: headers,
        timeout: 1000 * 10
      };
      let request = https.get(options, response => {
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
            console.log(`HTTP GET https://${hostname}${path} => ${response.statusCode}`);
            resolve({ status: response.statusCode, headers: response.headers, body: buffer });
          });
        });
      request.on('error', error => reject(error));
      request.on('timeout', () => {
          console.log(`HTTP GET https://${hostname}${path} => TIMEOUT`);
          reject(new Error(`HTTP Timeout`));
        });
    }));
}

async function get_redirected(hostname, path, headers, get) {
  return get(hostname, path, headers).then(response => {
      if (300 <= response.status && response.status < 400 && response.headers['location']) {
        let location = response.headers['location'];
        let hostname_new = null;
        let path_new = null;
        if (location.startsWith('http://') || location.startsWith('https://')) {
          location = location.substring(location.indexOf('://') + 3);
          hostname_new = location.includes('/') ? location.substring(0, location.indexOf('/')) : location;
          path_new = location.includes('/') ? location.substring(location.indexOf('/'), location.length) : '/';
        } else if (location.startsWith('/')) {
          hostname_new = hostname;
          path_new = location;
        } else {
          return response; // unknown redirect
        }
        return get_redirected(hostname_new, path_new, headers, get);
      } else return response;
    });
}

async function get_failed(hostname, path, headers, get) {
  return retry(() => get(hostname, path, headers).then(response => {
      if (500 <= response.status && response.status < 600) throw new Error('HTTP Error ' + response.status);
      else return response;
    }));
}

async function get_rate_limited(hostname, path, headers, get) {
  return get_rate_limited_v2(hostname, path, headers, get);
}

async function get_rate_limited_v1(hostname, path, headers, get) {
  for(;;) {
    let response = await get(hostname, path, headers);
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

async function get_rate_limited_v2(hostname, path, headers, get) {
  let cpath = path.split('/').filter(segment => !/\d/.test(segment)).join('/');

  // we need to update the feedback from the other side and keep our own count because
  // (1) the server side knows about requests that we dont and (2) sending many requests
  // in parallel may result in us violating the rate limit quite drastically
  // with this approach, worst case the server side responds with already counted requests
  // that are still active on our end when we check. so in these extreme case, this algorithm
  // only uses half the rate limit. if we send requests very fast, we tend to me more at the
  // rate limit because we send many before getting the first feedback.
  
  // check if there is a rate limit, and if not create a fake one to make canary request. that rate limit will be overridden after the first requests
  if (!rate_limits[hostname] || rate_limits[hostname].length == 0) rate_limits[hostname] = [ create_rate_limit(1, 1, 0, true) ];
  if (!rate_limits[hostname + cpath] || rate_limits[hostname + cpath].length == 0) rate_limits[hostname + cpath] = [ create_rate_limit(1, 1, 0, true) ];
  if (!active_counts[hostname]) active_counts[hostname] = 0;
  if (!active_counts[hostname + cpath]) active_counts[hostname + cpath] = 0;
  
  for(;;) {
    // check and reset slotting of all rate limits
    rate_limits[hostname].concat(rate_limits[hostname + cpath])
      .filter(rl => Date.now() > rl.timestamp + rl.length * 1000 || (rl.next && Date.now() > rl.timestamp + rl.next * 1000))
      .forEach(rl => { rl.count = 0; rl.timestamp = Date.now() });
    
    // check if any of the rate limits have been hit, if so, wait the appropriate amount of time and restart
    let rate_limits_hit_host = rate_limits[hostname].filter(rl => rl.count + active_counts[hostname] >= rl.max);
    let rate_limits_hit_path = rate_limits[hostname + cpath].filter(rl => rl.count + active_counts[hostname + cpath] >= rl.max);
    if (rate_limits_hit_host.length + rate_limits_hit_path.length > 0) {
      await delay(rate_limits_hit_host.concat(rate_limits_hit_path).map(rl => rl.next ? Math.min(rl.next, rl.length) : rl.length).reduce((l1, l2) => Math.max(l1, l2), 0) * 1000);
      continue;
    }
    
    // execute the request
    let response = null;
    try {
      active_counts[hostname]++;
      active_counts[hostname + cpath]++;
      response = await get(hostname, path, headers);
    } finally {
      active_counts[hostname]--;
      active_counts[hostname + cpath]--;
    }
    
    // check for rate limit headers and parse them. if there are none, create fake rate limits
    if (response.headers['x-app-rate-limit'] && response.headers['x-method-rate-limit']) {
      // "x-app-rate-limit":"20:1,100:120","x-app-rate-limit-count":"43:1,20:120"
      // "x-method-rate-limit":"250:10","x-method-rate-limit-count":"40:10"
      rate_limits[hostname] = parse_rate_limits_rito_style(response, 'x-app-rate-limit');
      rate_limits[hostname + cpath] = parse_rate_limits_rito_style(response, 'x-method-rate-limit');
    } else if (response.headers['x-ratelimit-limit'] && response.headers['x-ratelimit-remaining'] && response.headers['x-ratelimit-reset']) {
      // x-ratelimit-limit: 100
      // x-ratelimit-remaining: 97
      // x-ratelimit-reset: 1667205263
      let max = parseInt(response.headers['x-ratelimit-limit']);
      let length = Math.floor(Math.max(1, parseInt(response.headers['x-ratelimit-reset']) - Date.now() / 1000));
      let count = max - parseInt(response.headers['x-ratelimit-remaining']);
      rate_limits[hostname] = create_rate_limit(max, length, count);
      rate_limits[hostname + cpath] = create_rate_limit(max, length, count);
    } else {
      rate_limits[hostname] = [ create_rate_limit(100, 1, 0, true) ];
      rate_limits[hostname + cpath] = [ create_rate_limit(100, 1, 0, true) ];
    }
    
    // if the request still was 429, restart the process and give hint t about when to retry.
    if (response.status == 429) {
      if (response.headers['retry-after']) {
        let next = parseInt(response.headers['retry-after']);
        rate_limits[hostname].filter(rl => rl.count + active_counts[hostname] >= rl.max).forEach(rl => rl.next = next);
        rate_limits[hostname + cpath].filter(rl => rl.count + active_counts[hostname + cpath] >= rl.max).forEach(rl => rl.next = next);
      }
      console.error(`HTTP rate limit hit (${hostname}): ` + rate_limits[hostname].map(rl => `${rl.count}/${rl.max} (${rl.length},${rl.next})`).join(',')); 
      console.error(`HTTP rate limit hit (${hostname}${cpath}): ` + rate_limits[hostname + cpath].map(rl => `${rl.count}/${rl.max} (${rl.length},${rl.next})`).join(',')); 
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

module.exports = { get, get_full, get_simple }
