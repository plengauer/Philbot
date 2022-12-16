const fs = require('fs');
const memory = require('../../../shared/memory.js');
const memory_kv = require('../../../shared/memory_kv.js');
const statistics = require('../../../shared/statistics.js');
const discord = require('../../../shared/discord.js');
const identity = require('../../../shared/identity.js');

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

async function sendUsersActivityWarning(user_ids) {
  return Promise.all(user_ids.map(user_id => sendUserActivityWarning(user_id)));
}

async function cleanUserActivity(user_id) {
  let recent = await Promise.all([
      memory.consume(`activities:recent:user:${user_id}`, []),
      memory.get(`activities:permanent:user:${user_id}`, [])
    ]).then(lists => lists.flatMap(list => list));
  return recent.length > 0 ? memory.set(`activities:all:user:${user_id}`, recent, 60 * 60 * 24 * 7 * 13) : memory.unset(`activities:all:user:${user_id}`);
}

async function cleanUsersActivities(user_ids) {
  return Promise.all(user_ids.map(user_id => cleanUserActivity(user_id)));
}

async function cleanUsersExcept(except_user_ids) {
  return memory.list()
    .then(entries => memory.clear(
      entries
        .map(entry => entry.key)
        .filter(key => key.includes('user:') && !key.includes('statistics:'))
        .filter(key => !except_user_ids.some(except_user_id => key.includes(except_user_id)))
      )
    );
}

async function sendAd(user_id) {
  return discord.try_dms(user_id, ('' + fs.readFileSync('./ad.txt')).replace(/\$\{link_discord_add\}/g, identity.getRootURL() + '/addme'));
}

async function sendRandomAds(user_ids) {
  return Promise.all(user_ids
      .filter(user_id => Math.random() < 0.1)
      .map(user_id => sendAd(user_id))
    );
}

function extractToken(key, name) {
  let index = key.indexOf(':' + name + ':');
  if (index < 0) return undefined;
  let f = index + (':' + name + ':').length;
  let t = key.indexOf(':', f + 1);
  if (t < 0) t = key.length;
  return key.substring(f, t);
}

function computeLicenseConsumption(count) {
  return '' + (count / process.env.REQUEST_LIMIT * 100) + '% (' + count + ')';
}

async function createReport() {
  let counts = await statistics.list(key => key.includes('trigger:') && !key.endsWith(':total'));
  let guilds = await discord.guilds_list();
  let users = await discord.users_list();
  let activities = Array.from(new Set(counts.map(entry => extractToken(entry.key, 'activity')).filter(activity => !!activity)));

  let memory_percentage = (await memory_kv.count()) / memory_kv.capacity() * 100;
  
  let report = '\n'
    + '**Monthly Report**:'.toUpperCase() + '\n'
    + '\t' + `License Consumption: `
      + computeLicenseConsumption(counts.map(entry => entry.value).reduce((c1, c2) => c1 + c2, 0))
      + '\n'
    + '\t' + `Memory Consumption: ${memory_percentage}%` + '\n'
    + '\t' + `Guilds: ${guilds.length}` + '\n'
    + '\t' + `Users: ${users.length}` + '\n';
  
  let trigger_guild_counts = {};
  counts
    .filter(entry => entry.key.includes(':guild:'))
    .forEach(entry =>
      trigger_guild_counts[extractToken(entry.key, 'guild')] =
        (trigger_guild_counts[extractToken(entry.key, 'guild')] ? trigger_guild_counts[extractToken(entry.key, 'guild')] : 0)
        + entry.value
    );
  let max_trigger_guild = undefined;
  for (let guild in trigger_guild_counts) {
    if (!max_trigger_guild || trigger_guild_counts[guild] > trigger_guild_counts[max_trigger_guild]) max_trigger_guild = guild;
  }
  
  let trigger_user_counts = {};
  counts
    .filter(entry => entry.key.includes(':user:'))
    .forEach(entry =>
      trigger_user_counts[extractToken(entry.key, 'user')] =
        (trigger_user_counts[extractToken(entry.key, 'user')] ? trigger_user_counts[extractToken(entry.key, 'user')] : 0)
        + entry.value
    );
  let max_trigger_user = undefined;
  for (let user in trigger_user_counts) {
    if (!max_trigger_user || trigger_user_counts[user] > trigger_user_counts[max_trigger_user]) max_trigger_user = user;
  }
  
  let trigger_activity_counts = {};
  counts
    .filter(entry => entry.key.includes(':activity:'))
    .forEach(entry =>
      trigger_activity_counts[extractToken(entry.key, 'activity')] =
        (trigger_activity_counts[extractToken(entry.key, 'activity')] ? trigger_activity_counts[extractToken(entry.key, 'activity')] : 0)
        + entry.value
    );
  let max_trigger_activity = undefined;
  for (let activity in trigger_activity_counts) {
    if (!max_trigger_activity || trigger_activity_counts[activity] > trigger_activity_counts[max_trigger_activity]) max_trigger_activity = activity;
  }
  
  report += '\n'
    + '\t' + `**Top License Consumption (Guild)**: ${max_trigger_guild} ` + computeLicenseConsumption(trigger_guild_counts[max_trigger_guild]) + '\n'
    + '\t' + `**Top License Consumption (User)**: ${max_trigger_user} ` + computeLicenseConsumption(trigger_user_counts[max_trigger_user]) + '\n'
    + '\t' + `**Top License Consumption (Activity)**: ${max_trigger_activity} ` + computeLicenseConsumption(trigger_activity_counts[max_trigger_activity]) + '\n';
    
  report += '\n' + '**License Consumption per Guild**:' + '\n'
    + guilds.filter(guild => trigger_guild_counts[guild.id] && trigger_guild_counts[guild.id] > 0).map(guild =>
      '\t' + `${guild.name} (${guild.id}): ` + computeLicenseConsumption(trigger_guild_counts[guild.id])
    ).join('\n');
  report += '\n' + '**License Consumption per User**:' + '\n'
    + users.filter(user => trigger_user_counts[user.id] && trigger_user_counts[user.id] > 0).map(user =>
      '\t' + `${user.username}#${user.discriminator} (${user.id}): ` + computeLicenseConsumption(trigger_user_counts[user.id])
    ).join('\n');
  report += '\n' + '**License Consumption per Activity**:' + '\n'
    + activities.filter(activity => trigger_activity_counts[activity] && trigger_activity_counts[activity] > 0).map(activity =>
      '\t' + `${activity}: ` + computeLicenseConsumption(trigger_activity_counts[activity])
    ).join('\n');
  
  report += '\n' + '**License Consumption per Trigger**:' + '\n'
    + '\t' + 'monthly: ' + computeLicenseConsumption(counts .filter(entry => entry.key.includes('monthly')) .map(entry => entry.value).reduce((c1, c2) => c1 + c2, 0)) + '\n'
    + '\t' + 'daily: ' + computeLicenseConsumption(counts.filter(entry => entry.key.includes('daily')).map(entry => entry.value).reduce((c1, c2) => c1 + c2, 0)) + '\n'
    + '\t' + 'discord.voice.state.update: ' + computeLicenseConsumption(counts.filter(entry => entry.key.includes('discord.voice.state.update')).map(entry => entry.value).reduce((c1, c2) => c1 + c2, 0)) + '\n'
    + '\t' + 'discord.presence.update.activity: ' + computeLicenseConsumption(counts.filter(entry => entry.key.includes('discord.presence.update.activity')).map(entry => entry.value).reduce((c1, c2) => c1 + c2, 0)) + '\n'
    + '\t' + 'discord.message.create: ' + computeLicenseConsumption(counts.filter(entry => entry.key.includes('discord.message.create')).map(entry => entry.value).reduce((c1, c2) => c1 + c2, 0)) + '\n'
    + '\t' + 'discord.guild.member.add: ' + computeLicenseConsumption(counts.filter(entry => entry.key.includes('discord.guild.member.add')).map(entry => entry.value).reduce((c1, c2) => c1 + c2, 0)) + '\n'
    + '\t' + 'discord.bot.playback.finished: ' + computeLicenseConsumption(counts.filter(entry => entry.key.includes('discord.bot.playback.finished')).map(entry => entry.value).reduce((c1, c2) => c1 + c2, 0)) + '\n'
    + '\t' + 'discord.bot.guild.joined: ' + computeLicenseConsumption(counts.filter(entry => entry.key.includes('discord.bot.guild.joined')).map(entry => entry.value).reduce((c1, c2) => c1 + c2, 0)) + '\n';

  return report;
}

async function handle() {
  return Promise.all([
    statistics.record('trigger:monthly'),
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
      ]))
  ])
  .then(() => createReport().then(report => discord.dms(process.env.OWNER_DISCORD_USER_ID, report)).finally(() => statistics.reset()))
  .then(() => undefined)
}

module.exports = { handle }
  
