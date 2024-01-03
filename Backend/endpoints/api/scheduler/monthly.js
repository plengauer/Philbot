const fs = require('fs');
const memory = require('../../../shared/memory.js');
const discord = require('../../../shared/discord.js');
const identity = require('../../../shared/identity.js');
const ai = require('../../../shared/ai.js');

const ttl = 60 * 60 * 24 * (31 + 1);
const birthday_track = 'https://www.youtube.com/watch?v=jgfu30N-zpY';
const muted_activities = [
  // special integrations for non-games
  'Spotify',
  // embedded activities that dont make a lot of sense to handle
  'Watch Together',
  // premid browser integrations
  'PreMiD',
  'Movies & TV',
  'Netflix',
  'SoundCloud',
  'YouTube',
  'YouTube Music',
  'Twitch',
  'Disney+',
  'Prime Video',
  'Hulu',
  'HBO GO',
  'HBO Max',
  'Shazam',
  'Spotify Podcasts',
  'Apple Music',
  'Amazon Music',
  // weird launchers showing up as games
  'Badlion Client',
  'Red Dead Online',
  'Rockstar Games Launcher',
  'Steam',
  'SteamVR',
  'Epic Games',
  'Epic Games Launcher',
  'BattlEye Launcher',
  '2K Launcher',
  // other apps people use a lot
  'Visual Studio Code',
  'Visual Studio',
];

async function handle() {
  return Promise.all([
    memory.fill(muted_activities.map(muted_activity => memory.entry(`mute:activity:${muted_activity}`, true, ttl))),
    memory.set('track:birthday', birthday_track, ttl),
    discord.users_list(guild_id => memory.get(`notification:role:guild:${guild_id}`, null))
      .then(users => users.map(user => user.id))
      .then(user_ids => Promise.all([
        sendUsersActivityWarning(user_ids),
        sendRandomAds(user_ids)
      ]))
      .then(() => discord.users_list())
      .then(users => users.map(user => user.id))
      .then(user_ids => Promise.all([
        cleanUsersActivities(user_ids),
        cleanUsersExcept(user_ids)
      ])),
    resetAvatar()
  ])
  .then(() => undefined)
}

async function sendUsersActivityWarning(user_ids) {
  return Promise.all(user_ids.map(user_id => sendUserActivityWarning(user_id)));
}

async function sendUserActivityWarning(user_id) {
  let all_promise = memory.get(`activities:all:user:${user_id}`, []);
  let recent_promise = Promise.all([
      memory.get(`activities:recent:user:${user_id}`, []),
      memory.get(`activities:permanent:user:${user_id}`, [])
    ]).then(lists => lists.flatMap(list => list));
  let all = await all_promise;
  let recent = await recent_promise;
  if (all.length > 0 && recent.length == 0) {
    return discord.try_dms(user_id,
      'Hey, I haven\'t seen you playing anything recently.' + ' '
      + 'Some of my features depend on me seeing what you play.' + ' '
      + 'If you still wanna use these features (say \'help\' to learn more), make sure you are online when you play and discord rich presence is turned on (Settings -> Activity Status -> Display current activity as a status message).'
    );
  } else {
    return Promise.resolve();
  }
}

async function sendRandomAds(user_ids) {
  return Promise.all(user_ids
      .filter(user_id => Math.random() < 0.05)
      .map(user_id => sendAd(user_id))
    );
}

async function sendAd(user_id) {
  return identity.getPublicURL().then(url => discord.try_dms(user_id, ('' + fs.readFileSync('./ad.txt')).replace(/\$\{link_discord_add\}/g, url + '/invite')));
}

async function cleanUsersActivities(user_ids) {
  return Promise.all(user_ids.map(user_id => cleanUserActivity(user_id)));
}

async function cleanUserActivity(user_id) {
  let recent = await Promise.all([
      memory.consume(`activities:recent:user:${user_id}`, []),
      memory.get(`activities:permanent:user:${user_id}`, [])
    ]).then(lists => lists.flatMap(list => list));
  return recent.length > 0 ? memory.set(`activities:all:user:${user_id}`, recent, 60 * 60 * 24 * 7 * 13) : memory.unset(`activities:all:user:${user_id}`);
}

async function cleanUsersExcept(except_user_ids) {
  return memory.list()
    .then(entries => memory.clear(
      entries
        .map(entry => entry.key)
        .filter(key => key.includes('user:'))
        .filter(key => !except_user_ids.some(except_user_id => key.includes(except_user_id)))
      )
    );
}

async function resetAvatar() {
  let model = { vendor: 'openai', name: "dall-e-3", size: "1024x1024", quality: "hd" };
  let me = await discord.me();
  let prompt = `An avatar for a Discord bot called "${me.username}"`;
  switch (new Date().getUTCMonth() + 1) {
    case 1: prompt += ' with a vibe of winter'; break;
    case 3: prompt += ' with a vibe of spring'; break;
    case 6: prompt += ' with a vibe of summer'; break;
    case 9: prompt += ' with a vibe of autumn'; break;
    case 10: prompt += ' with a vibe of halloween'; break;
    case 12: prompt += ' with a vibe of christmas'; break;
  }
  let format = 'png';
  let avatar_stream = await ai.createImage(model, me.id, prompt, format);
  if (!avatar_stream) return;
  return discord.me_avatar_update(format, avatar_stream);
}

module.exports = { handle }
  
