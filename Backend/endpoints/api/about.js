const lib = require('lib')({token: process.env.STDLIB_SECRET_TOKEN});
const sdk = require('../shared/opentelemetry.js').create(context.service.version);
await sdk.start();
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode');
const fs = require('fs');
const discord = require('../shared/discord.js');

async function handle() {
  let me = await discord.me();
  let about = ('' + fs.readFileSync('./about.txt'))
    .replace(/\$\{name\}/g, `${me.username}`)
    .replace(/\$\{version\}/g, context.service.version)
    .replace(/\$\{link_monitoring\}/g, `this <a href="/monitoring">link</a>`)
    .replace(/\$\{link_logs\}/g, `this <a href="/logs">link</a>`)
    .replace(/\$\{link_discord_add\}/g, `this <a href="/deploy">link</a>`)
    .replace(/\*\*(.*)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<p/>');
  return {
    statusCode: 200,
    headers: { 'content-type': 'text/html' },
    body: `<html><head><title>${me.username} About</title></head><body>${about}</body></html>`
  };
}

let span = tracer.startSpan('/about', { kind: opentelemetry.SpanKind.SERVER }, undefined);
return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), handle)
  .finally(() => span.end())
  .finally(() => sdk.shutdown());