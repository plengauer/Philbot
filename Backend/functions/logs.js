const sdk = require('../shared/opentelemetry.js').create(context.service.version);
await sdk.start();
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode');
const identity = require('../shared/identity.js');

async function handle() {
  let account = identity.getAccountName();
  let project = identity.getProjectName();
  let version = context.service.version;
  return {
    statusCode: 302,
    headers: { 'content-type': 'text/plain', 'location': `https://autocode.com/logs/${account}/${project}/${version}` },
    body: 'Found'
  };
}

let span = tracer.startSpan('/logs', { kind: opentelemetry.SpanKind.SERVER }, undefined);
return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), handle)
  .finally(() => span.end())
  .finally(() => sdk.shutdown());