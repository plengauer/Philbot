const sdk = require('../../shared/opentelemetry.js').create(context.service.version);
await sdk.start();
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode');
const statistics = require('../../shared/statistics.js');
const discord = require('../../shared/discord.js');
const features = require('../../shared/features.js');
const raid_protection = require('../../shared/raid_protection.js');

let span = tracer.startSpan('functions.events.discord.guild.member.add', { kind: opentelemetry.SpanKind.CONSUMER }, undefined);
return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
    let guild_id = context.params.event.guild_id;
    let user_id = context.params.event.user.id;
    span.setAttribute('discord.guild.id', guild_id);
    span.setAttribute('discord.user.id', user_id);
    return Promise.all([
      statistics.record(`trigger:discord.guild.member.add:guild:${guild_id}:user:${user_id}`),
      discord.me()
        .then(me => discord.guild_retrieve(guild_id)
          .then(guild => 
            discord.try_dms(user_id, `Hi <@${user_id}>, welcome to ${guild.name}! I'm your friendly neighborhood bot. I can play music, tell jokes, or schedule weekly events, whatever you need. Type \'<@${me.id}> help\' to learn how to talk to me. In case you talk to me in a DM channel, just skip the \'<@${me.id}>\'. I'm always around and happy to help.`)
          ).catch(ex => {
            span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR });
            span.recordException(ex);
            throw ex;
          })
        ),
      features.isActive(guild_id, 'raid protection').then(active => active ? raid_protection.on_guild_member_added(guild_id, user_id) : Promise.resolve())
    ]);
  })
  .finally(() => span.end())
  .finally(() => sdk.shutdown());
