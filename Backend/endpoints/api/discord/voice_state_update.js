const memory = require('../../../shared/memory.js');
const discord = require('../../../shared/discord.js');
const player = require('../../../shared/player.js');
const features = require('../../../shared/features.js');
const role_management = require('../../../shared/role_management.js');

async function handle(payload) {
  return Promise.all([
    payload.channel_id ?
      memory.set(`voice_channel:user:${payload.user_id}`, { guild_id: payload.guild_id, channel_id: payload.channel_id }, 60 * 60 * 24).then(() => playGreeting(payload.guild_id, payload.user_id)) :
      memory.unset(`voice_channel:user:${payload.user_id}`),
    payload.channel_id ? checkAndStartEvents(payload.guild_id, payload.channel_id) : Promise.resolve(),
    discord.me().then(me => me.id == payload.user_id ? player.on_voice_state_update(payload.guild_id, payload.channel_id, payload.session_id) : Promise.resolve()),
    features.isActive(payload.guild_id, 'role management').then(active => active ? role_management.on_voice_state_update(payload.guild_id, payload.user_id, payload.channel_id) : Promise.resolve())
  ])
  .then(results => results[0])
  .then(reply => reply && reply.command ? { status: 200, body: reply } : undefined);
}

async function checkAndStartEvents(guild_id, channel_id) {
  let now = new Date();
  return discord.scheduledevents_list(guild_id).then(events => events.map(event => {
    if (event.channel_id === channel_id && event.status == 1 && new Date(Date.parse(event.scheduled_start_time).valueOf() - 1000 * 60 * 60) < now) {
      return discord.scheduledevent_modify(guild_id, event.id, { status: 2 /* 'ACTIVE' */ });
    } else {
      return Promise.resolve();
    }
  }));
}

async function playGreeting(guild_id, user_id) {
  let now = new Date();
  let canPlay = features.isActive(guild_id, 'player');
  let birthday = memory.get(`birthday:user:${user_id}`, null);
  let birthday_track = memory.get('track:birthday', null);
  let intro_track = memory.get(`track:intro:user:${user_id}:guild:${guild_id}`, null);
  if (await canPlay && await birthday_track && await birthday && (await birthday).month == now.getUTCMonth() + 1 && (await birthday).day == now.getUTCDate()) {
    return player.play(guild_id, user_id, null, await birthday_track);
  } else if (await canPlay && await intro_track) {
    return player.play(guild_id, user_id, null, await intro_track);
  } else {
    return Promise.resolve();
  }
}

module.exports = { handle }
