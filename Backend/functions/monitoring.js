const sdk = require('../shared/opentelemetry.js').create(context.service.version);
await sdk.start();
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode');

async function handle() {
  return {
    statusCode: 302,
    headers: { 'Content-Type': 'text/plain', 'Location': process.env.LINK_OBSERVABILITY },
    body: 'Found'
  };
}

let span = tracer.startSpan('/monitoring', { kind: opentelemetry.SpanKind.SERVER }, undefined);
return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), handle)
  .finally(() => span.end())
  .finally(() => sdk.shutdown());