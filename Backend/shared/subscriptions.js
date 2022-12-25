const memory = require('./memory.js');
const curl = require('./curl.js');
const discord = require('./discord.js');

async function add(guild_id, channel_id, link) {
  if (link.startsWith('https://www.youtube.com/channel/')) throw new Error(`${link} must be a valid link to a youtube channel.`);
  return memory.get(configkey(guild_id, channel_id), [])
    .then(configs => configs.concat([{ type: 'youtube', link: link }]))
    .then(configs => memory.set(configkey(guild_id, channel_id), configs));
}

async function remove(guild_id, channel_id, link) {
  return memory.get(configkey(guild_id, channel_id), [])
    .then(configs => configs.filter(config => config.link == link))
    .then(configs => configs.length > 0 ? memory.set(configkey(guild_id, channel_id), configs) : memory.unset(configkey(guild_id, channel_id)));
}

async function tick() {
  return discord.guilds_list().then(guilds => Promise.all(guilds.map(guild => discord.guild_channels_list(guild.id).then(channel => checkAndNotify(guild.id, channel.id)))));
}

async function checkAndNotify(guild_id, channel_id) {
  return memory.get(configkey(guild_id, channel_id), [])
    .then(configs => Promise.all(configs.map(config => checkAndNotifyForConfig(guild_id, channel_id, config))));
}

async function checkAndNotifyForConfig(guild_id, channel_id, config) {
  let youtube_channel_id = config.link.substring(config.link.lastIndexOf('/') + 1);
  let last_check_key = `subscriptions:last:guild:${guild_id}:channel:${channel_id}:external_channel:${youtube_channel_id}`;
  let now = Date.now();
  let last_check = await memory.get(last_check_key, now);
  await memory.set(last_check_key, now);
  let result = await curl.request({
      hostname: 'www.googleapis.com',
      path: `/youtube/v3/search?key=${process.env.YOUTUBE_API_KEY}&part=snippet&type=video&channelId=${youtube_channel_id}&order=date&maxResults=50&publishedAfter=` + encodeURIComponent(last_check.toISOString()),
    })
    .then(result => result.items)
    .catch(error = null);
  if (!result) {
    return discord.post(channel_id, `Subscription for ${config.link} is broken!`);
  } else if (result.length == 0) {
    return;
  } else if (result.length == 1) {
    return discord.post(channel_id, `${items[0].channelTitle} has published **${items[0].snippet.title}**: https://www.youtube.com/watch?v=${items[0].id.videoId}.`);
  } else {
    return discord.post(channel_id, `${items[0].channelTitle} has published ${items.length} new videos: ` + items.map(item => `https://www.youtube.com/watch?v=${item.id.videoId}`).join(', ') + '.');
  }
}

function configkey(guild_id, channel_id) {
  return `subscriptions:config:guild:${guild_id}:channel:${channel_id}`;
}

module.exports = { add, remove, tick }
