const sdk = require('../shared/opentelemetry.js').create(context.service.version);
await sdk.start();
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode');
const permissions = require('../shared/permissions.js');

async function handle() {
  let required = permissions.compile(permissions.required());
  return {
    statusCode: 302,
    headers: { 'content-type': 'text/plain', 'location': `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&scope=identify%20bot&permissions=${required}` },
    body: 'Found'
  };
}

let span = tracer.startSpan('/deploy', { kind: opentelemetry.SpanKind.SERVER }, undefined);
return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), handle)
  .finally(() => span.end())
  .finally(() => sdk.shutdown());