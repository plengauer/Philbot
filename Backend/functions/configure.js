const sdk = require('../shared/opentelemetry.js').create(context.service.version);
await sdk.start();
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode');

async function handle() {
  return {
    statusCode: 301,
    headers: { 'content-type': 'text/plain', 'location': `https://discord.com/developers/applications/${process.env.DISCORD_CLIENT_ID}` },
    body: 'Moved Permanently'
  };
}

let span = tracer.startSpan('/configure', { kind: opentelemetry.SpanKind.SERVER }, undefined);
return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), handle)
  .finally(() => span.end())
  .finally(() => sdk.shutdown());