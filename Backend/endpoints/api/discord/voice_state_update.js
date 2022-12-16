const sdk = require('../../shared/opentelemetry.js').create(context.service.version);
await sdk.start();
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode');
const memory = require('../../shared/memory.js');
const statistics = require('../../shared/statistics.js');
const discord = require('../../shared/discord.js');
const player = require('../../shared/player.js');
const features = require('../../shared/features.js');

async function playGreeting(guild_id, user_id) {
  let now = new Date();
  let canPlay = features.isActive(guild_id, 'player');
  let birthday = memory.get(`birthday:user:${user_id}`, null);
  let birthday_track = memory.get('track:birthday', null);
  let intro_track = memory.get(`track:intro:user:${user_id}:guild:${guild_id}`, null);
  if (await canPlay && await birthday_track && await birthday && (await birthday).month == now.getUTCMonth() + 1 && (await birthday).day == now.getUTCDate()) {
    return Promise.all([
        player.play(guild_id, user_id, null, await birthday_track),
        statistics.record(`birthday:song:guild:${guild_id}:user:${user_id}`)
      ]);
  } else if (await canPlay && await intro_track) {
    return Promise.all([
        player.play(guild_id, user_id, null, await intro_track),
        statistics.record(`intro:song:guild:${guild_id}:user:${user_id}`)
      ]);
  } else {
    return Promise.resolve();
  }
}

async function checkAndStartEvents(guild_id, channel_id) {
  let now = new Date();
  return discord.scheduledevents_list(guild_id).then(events => events.map(event => {
    if (event.channel_id === channel_id && event.status == 1 && new Date(Date.parse(event.scheduled_start_time).valueOf() - 1000 * 60 * 60) < now) {
      return discord.scheduledevent_modify(guild_id, event.id, { status: 'ACTIVE' });
    } else {
      return Promise.resolve();
    }
  }));
}

async function checkUnexpectedVoiceDisconnect(guild_id, channel_id, user_id) {
  return Promise.all([
    discord.me().then(me => me.id == user_id),
    player.hasRecentVoiceOperation(guild_id).then(value => !value)
  ]).then(values => {
    if (values.every(value => !!value)) {
      return player.playNext(guild_id, null);
    } else {
      return Promise.resolve();
    }
  })
}

let span = tracer.startSpan('functions.events.discord.voice.state.update', { kind: opentelemetry.SpanKind.CONSUMER }, undefined);
return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
    let guild_id = context.params.event.guild_id;
    let channel_id = context.params.event.channel_id;
    let user_id = context.params.event.user_id;
    span.setAttribute("discord.guild.id", guild_id);
    span.setAttribute("discord.channel.id", channel_id);
    span.setAttribute("discord.user.id", user_id);
    return Promise.all([
      statistics.record(`trigger:discord.voice.state.update:guild:${guild_id}:channel:${channel_id}:user:${user_id}`),
      channel_id ? checkAndStartEvents(guild_id, channel_id) : Promise.resolve(),
      channel_id ?
        memory.set(`voice_channel:user:${user_id}`, { guild_id: guild_id, channel_id: channel_id }, 60 * 60 * 24).then(() => playGreeting(guild_id, user_id)) :
        memory.unset(`voice_channel:user:${user_id}`),
      channel_id ? Promise.resolve() : checkUnexpectedVoiceDisconnect(guild_id, channel_id, user_id)
    ]).catch(ex => {
      span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR });
      span.recordException(ex);
      throw ex;
    });
  })
  .finally(() => span.end())
  .finally(() => sdk.shutdown());
