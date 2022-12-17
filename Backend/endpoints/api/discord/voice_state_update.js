const memory = require('../../../shared/memory.js');
const discord = require('../../../shared/discord.js');
const player = require('../../../shared/player.js');
const features = require('../../../shared/features.js');

async function handle(payload) {
  return Promise.all([
    payload.channel_id ? checkAndStartEvents(payload.guild_id, payload.channel_id) : Promise.resolve(),
    payload.channel_id ?
      memory.set(`voice_channel:user:${payload.user_id}`, { guild_id: payload.guild_id, channel_id: payload.channel_id }, 60 * 60 * 24).then(() => playGreeting(payload.guild_id, payload.user_id)) :
      memory.unset(`voice_channel:user:${payload.user_id}`),
    payload.channel_id ? Promise.resolve() : checkUnexpectedVoiceDisconnect(payload.guild_id, payload.channel_id, payload.user_id)
  ]).then(() => undefined)
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

module.exports = { handle }
