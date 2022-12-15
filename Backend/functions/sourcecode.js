const sdk = require('../shared/opentelemetry.js').create(context.service.version);
await sdk.start();
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode');
const identity = require('../shared/identity.js');

async function handle() {
  let account = identity.getAccountName();
  let project = identity.getProjectName();
  return {
    statusCode: 302,
    headers: { 'content-type': 'text/plain', 'location': `https://autocode.com/p/${account}/${project}/dev/` },
    body: 'Found'
  };
}

let span = tracer.startSpan('/sourcecode', { kind: opentelemetry.SpanKind.SERVER }, undefined);
return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), handle)
  .finally(() => span.end())
  .finally(() => sdk.shutdown());