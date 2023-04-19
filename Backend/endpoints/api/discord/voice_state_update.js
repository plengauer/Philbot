const memory = require('../../../shared/memory.js');
const discord = require('../../../shared/discord.js');
const player = require('../../../shared/player.js');
const features = require('../../../shared/features.js');
const role_management = require('../../../shared/role_management.js');

async function handle(payload) {
  return Promise.all([
    payload.channel_id ?
      memory.set(`voice_channel:user:${payload.user_id}`, { guild_id: payload.guild_id, channel_id: payload.channel_id }, 60 * 60 * 24) :
      memory.unset(`voice_channel:user:${payload.user_id}`),
    payload.channel_id ? playGreeting(payload.guild_id, payload.channel_id, payload.user_id) : Promise.resolve(),
    payload.channel_id ? checkAndStartEvents(payload.guild_id, payload.channel_id) : Promise.resolve(),
    discord.me().then(me => me.id == payload.user_id ? player.on_voice_state_update(payload.guild_id, payload.channel_id, payload.session_id) : Promise.resolve()),
    features.isActive(payload.guild_id, 'role management').then(active => active ? role_management.on_voice_state_update(payload.guild_id, payload.user_id, payload.channel_id) : Promise.resolve()),
    payload.channel_id ? guessActivities(payload.guild_id, payload.channel_id, payload.user_id) : Promise.resolve()
  ]).then(() => undefined);
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

async function playGreeting(guild_id, channel_id, user_id) {
  let now = new Date();
  let canPlay = features.isActive(guild_id, 'player');
  let birthday = memory.get(`birthday:user:${user_id}`, null);
  let birthday_track = memory.get('track:birthday', null);
  let intro_track = memory.get(`track:intro:user:${user_id}:guild:${guild_id}`, null);
  if (await canPlay && await birthday_track && await birthday && (await birthday).month == now.getUTCMonth() + 1 && (await birthday).day == now.getUTCDate()) {
    return player.play(guild_id, channel_id, await birthday_track);
  } else if (await canPlay && await intro_track) {
    return player.play(guild_id, channel_id, await intro_track);
  } else {
    return Promise.resolve();
  }
}

async function guessActivities(guild_id, channel_id, user_id) {
  if ((await memory.get(`activities:current:user:${user_id}`, [])).length > 0) return;
  let user_ids = [];
  let all_activities = [];
  for (let user_id of await discord.guild_members_list(guild_id).then(members => members.map(member => member.user.id))) {
    let voice_state = await memory.get(`voice_channel:user:${user_id}`, null);
    if (!voice_state) continue;
    if (voice_state.guild_id != guild_id || voice_state.channel_id != channel_id) continue;
    let activities = await memory.get(`activities:current:user:${user_id}`, []);
    if (activities.length == 0) continue;
    all_activities = all_activities.concat(activities);
  }
  let guessed = [];
  for (let activity of Array.from(new Set(all_activities))) {
    if (all_activities.filter(a => a == activity).length > all_activities.length / 2) guessed.push(activity);
  }
  if (guessed.length == 0) return;
  return Promise.all([
    memory.get(`activities:recent:user:${user_id}`, []).then(global_activities => 
      guessed.some(activity => !global_activities.includes(activity)) ?
        memory.set(`activities:recent:user:${user_id}`, global_activities.concat(guessed.filter(activity => !global_activities.includes(activity))), 60 * 60 * 24 * 31) :
        Promise.resolve()
    ),
    memory.get(`activities:all:user:${user_id}`, []).then(global_activities => 
      guessed.some(activity => !global_activities.includes(activity)) ?
        memory.set(`activities:all:user:${user_id}`, global_activities.concat(guessed.filter(activity => !global_activities.includes(activity))), 60 * 60 * 24 * 31) :
        Promise.resolve()
    )
  ]);
}

module.exports = { handle }
