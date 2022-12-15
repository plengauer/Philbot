const sdk = require('../shared/opentelemetry.js').create(context.service.version);
await sdk.start();
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode');
const curl = require('../shared/curl.js');

async function handle() {
  if (context.http.method != 'GET') {
    return respondError(501, 'Not Implemented');
  }
  
  let method = context.params.method;
  let interval = context.params.interval;
  let host = context.params.host;
  let path = context.params.path;
  let headers = context.http.headers;
  if (!host && !path) {
    return respondError(404, 'Not Found');
  }
  
  method = method ?? 'inject';
  interval = interval ?? 60;
  host = host ?? context.host;
  path = path ?? '/';
  
  switch (method) {
    case 'none':
      return respond(302, { 'content-type': 'text/plain', 'location': `https://${host}${path}` }, 'Found');
    case 'inject':
      headers['accept-encoding'] = 'identity';
      let response = await curl.get_full(host, path, filterIncomingHeaders(headers));
      if (response.status != 200) {
        return respond(response.status, filterOutgoingHeaders(response.headers), response.body);
      }
      return respond(200, filterOutgoingHeaders(response.headers), inject(response.body, interval, context.host, context.http.url));
    case 'embed':
      return respond(200, { 'content-type': 'text/html' }, inject(embed(host, path), interval, context.host, context.http.url));
    default:
      return respondError(501, 'Not Implemented');
  }
}

function respond(status, headers, body) {
  return { statusCode: status, headers: headers, body: body };
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

function inject(body, interval, host, path) {
  return body.replace(/<\/head>/g, `<meta http-equiv="Refresh" content="${interval}; URL=https://${context.host}${context.http.url}"/>$&`);
}

function embed(host, path) {
  const style = 'position:fixed; top:0; left:0; bottom:0; right:0; width:100%; height:100%; border:none; margin:0; padding:0; overflow:hidden; z-index:999999;';
  return `<html><head><title>${host}</title></head><body><iframe src="https://${host}${path}" style="${style}"/></body></html>`;
}

let span = tracer.startSpan('/autorefresh', { kind: opentelemetry.SpanKind.SERVER }, undefined);
return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), handle)
  .finally(() => span.end())
  .finally(() => sdk.shutdown());
