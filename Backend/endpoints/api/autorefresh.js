const curl = require('../../shared/curl.js');
const identity = require('../../shared/identity.js');

async function handle(params, headers) {
  let method = params.method;
  let interval = params.interval;
  let host = params.host;
  let path = params.path;
  if (!host) {
    return respondError(404, 'Not Found');
  }
  
  method = method ?? 'inject';
  interval = interval ?? 60;
  host = host ?? '127.0.0.1';
  path = path ?? '/';
  
  let public_url = await identity.getPublicURL();
  switch (method) {
    case 'none':
      return respond(302, { 'content-type': 'text/plain', 'location': `https://${host}${path}` }, 'Found');
    case 'inject':
      headers['accept-encoding'] = 'identity';
      let response = await curl.request_full({ hostname: host, path: path, headers: filterIncomingHeaders(headers) });
      if (response.status != 200) {
        return respond(response.status, filterOutgoingHeaders(response.headers), response.body);
      }
      return respond(200, filterOutgoingHeaders(response.headers), inject(response.body, interval, params, public_url));
    case 'embed':
      return respond(200, { 'content-type': 'text/html' }, inject(embed(host, path), interval, params, public_url));
    default:
      return respondError(501, 'Not Implemented');
  }
}

function respond(status, headers, body) {
  return { status: status, headers: headers, body: body };
}

function respondError(code, message) {
  return respond(code, { 'content-type': 'text/plain' }, message);
}

function filterIncomingHeaders(headers) {
  return filterHeaders(headers, [ 'cookie', 'user-agent', 'authorization' ], [ 'accept' ], []);
}

function filterOutgoingHeaders(headers) {
  return filterHeaders(headers, [], [ '' ], []);
}

function filterHeaders(input, includeExact, includeStartsWith, exclude) {
  let output = {};
  for (let field in input) {
    if (!includeExact.includes(field.toLowerCase()) && !includeStartsWith.some(header => field.toLowerCase().startsWith(header.toLowerCase()))) continue;
    if (exclude.includes(field.toLowerCase())) continue;
    output[field] = input[field];
  }
  return output;
}

async function inject(body, interval, params, public_url) {
  let url = public_url + '/autorefresh?' + Object.keys(params).map(key => `${key}=${params[key]}`).join('&');
  return body.replace(/<\/head>/g, `<meta http-equiv="Refresh" content="${interval}; URL=${url}"/>$&`);
}

function embed(host, path) {
  const style = 'position:fixed; top:0; left:0; bottom:0; right:0; width:100%; height:100%; border:none; margin:0; padding:0; overflow:hidden; z-index:999999;';
  return `<html><head><title>${host}</title></head><body><iframe src="https://${host}${path}" style="${style}"/></body></html>`;
}

module.exports = { handle }