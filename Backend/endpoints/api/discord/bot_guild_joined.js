const sdk = require('../../../../../shared/opentelemetry.js').create(context.service.version);
await sdk.start();
const lib = require('lib')({token: process.env.STDLIB_SECRET_TOKEN});
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode');
const memory = require('../../../../../shared/memory.js');
const statistics = require('../../../../../shared/statistics.js');

let span = tracer.startSpan('functions.events.discord.bot.guild.joined', { kind: opentelemetry.SpanKind.CONSUMER }, undefined);
return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
    let guild_id = context.params.event.id;
    span.setAttribute('discord.guild.id', guild_id);
    return Promise.all([
      statistics.record(`trigger:discord.bot.guild.joined:guild:${guild_id}`),
      Promise.all([
          lib.discord.guilds['@0.2.2'].retrieve({ guild_id: guild_id }),
          lib.discord.users['@0.2.0'].me.list()
        ]).then(values => values[0].system_channel_id ?
          lib.discord.channels['@0.2.0'].messages.create({
            channel_id: values[0].system_channel_id,
            content: `Hi, I'm <@${values[1].id}>. I can play music, tell jokes, schedule weekly events, whatever you need. Type \'<@${values[1].id}> help\' to learn how to talk to me. I'm always around and happy to help.`
          }) :
          Promise.resolve()
        ).catch(ex => {
          span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR });
          span.recordException(ex);
          throw ex;
        })
      ]);
  })
  .finally(() => span.end())
  .finally(() => sdk.shutdown());
  