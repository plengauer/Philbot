const sdk = require('../../shared/opentelemetry.js').create(context.service.version);
await sdk.start();
const lib = require('lib')({token: process.env.STDLIB_SECRET_TOKEN});
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode');
const memory = require('../../shared/memory.js');
const statistics = require('../../shared/statistics.js');
const player = require('../../shared/player.js');

async function handle(guild_id) {
  return (Math.random() < 0.99 ? player.playNext(guild_id, null) : player.play(guild_id, null, null, 'rick roll'));
}

let span = tracer.startSpan('functions.events.discord.bot.playback.finished', { kind: opentelemetry.SpanKind.CONSUMER }, undefined);
return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
    let guild_id = context.params.event.guild_id;
    span.setAttribute('discord.guild.id', guild_id);
    return Promise.all([
      statistics.record(`trigger:discord.bot.playback.finished:guild:${guild_id}`),
      handle(guild_id)
        .catch(ex => {
          span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR });
          span.recordException(ex);
          throw ex;
        })
    ]);
  })
  .finally(() => span.end())
  .finally(() => sdk.shutdown());
