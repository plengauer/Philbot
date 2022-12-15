const sdk = require('../shared/opentelemetry.js').create(context.service.version);
await sdk.start();
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode');

async function debug(params) {
  // put code here
}

let span = tracer.startSpan('/debug', { kind: opentelemetry.SpanKind.SERVER }, undefined);
return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => debug(context.params))
  .finally(() => span.end())
  .finally(() => sdk.shutdown());
