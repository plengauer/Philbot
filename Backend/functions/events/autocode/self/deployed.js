const sdk = require('../../../../shared/opentelemetry.js').create(context.service.version);
await sdk.start();
const lib = require('lib')({token: process.env.STDLIB_SECRET_TOKEN});
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode');
const memory = require('../../../../shared/memory.js');
const statistics = require('../../../../shared/statistics.js');

let span = tracer.startSpan('functions.autocode.self.deployed', { kind: opentelemetry.SpanKind.CONSUMER }, undefined);
return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
    return statistics.record('trigger:deployed')
      .catch(ex => {
        span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR });
        span.recordException(ex);
        throw ex;
      });
  })
  .finally(() => span.end())
  .finally(() => sdk.shutdown());
  
