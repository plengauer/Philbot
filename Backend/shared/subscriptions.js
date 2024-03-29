const process = require('process');
const memory = require('./memory.js');
const curl = require('./curl.js');
const discord = require('./discord.js');

const DAILY_YOUTUBE_API_VOLUME = parseInt(process.env["DAILY_YOUTUBE_API_VOLUME"] ?? "10000");
const YOUTUBE_QUERY_COST = 100;

async function add(guild_id, channel_id, link, filter) {
  let subscription = await link2subscription(link, filter);
  return memory.get(configkey(guild_id, channel_id), [])
    .then(configs => configs.concat([ subscription ]))
    .then(configs => memory.set(configkey(guild_id, channel_id), configs));
}

async function remove(guild_id, channel_id, link, filter) {
  let subscription = await link2subscription(link, filter);
  return memory.get(configkey(guild_id, channel_id), [])
    .then(configs => configs.filter(config => config.type != subscription.type || config.feed != subscription.feed || config.filter != subscription.filter))
    .then(configs => configs.length > 0 ? memory.set(configkey(guild_id, channel_id), configs) : memory.unset(configkey(guild_id, channel_id)));
}

async function link2subscription(link, filter) {
  filter = filter && filter.trim().length > 0 ? filter.trim() : undefined;
  if (link.startsWith('https://www.youtube.com/')) {
    // https://www.youtube.com/channel/UCeB4uRJGZJBjilC8LEF0cBA
    // https://www.youtube.com/@VivaLaDirtLeague
    // https://www.youtube.com/user/VivaLaDirtLeague
    link = link.substring('https://www.youtube.com/'.length);
    if (link.startsWith('channel/')) {
      link = link.substring('channel/'.length);
      link = link.includes('/') ? link.substring(0, link.indexOf('/')) : link;
      let response = await curl.request_full({ hostname: 'www.youtube.com', path: `/channel/${link}` });
      if (response.status != 200) throw new Error(`Channel ${link} does not exist!`);
      return { type: 'youtube', feed: link, filter: filter };
    } else if (link.startsWith('c/')) {
      return link2subscription('https://www.youtube.com/@' + link.substring('c/'.length));
    } else if (link.startsWith('@')) {
      link = link.substring('@'.length);
      link = link.includes('/') ? link.substring(0, link.indexOf('/')) : link;
      return link2subscription(`https://www.youtube.com/user/${link}`, filter);
    } else if (link.startsWith('user/')) {
      link = link.substring('user/'.length);
      link = link.includes('/') ? link.substring(0, link.indexOf('/')) : link;
      let items = await HTTP_YOUTUBE('/channels', { forUsername: link }).then(result => result.items.map(item => item.id))
        .catch(error => HTTP_YOUTUBE('/search', { part: 'snippet', type: 'channel', q: link }).then(result => result.items.map(item => item.id.channelId)))
      if (!items) throw new Error(`Cannot find a channel for youtube user ${link}!`);
      if (items.length == 0) throw new Error(`Youtube user ${link} has no channel!`);
      // if (items.length > 1) throw new Error(`Youtube user ${link} has more than one channel!`);
      return link2subscription(`https://www.youtube.com/channel/${items[0]}`, filter);
    } else {
      throw new Error('Link must be to a channel!')
    }
  } else {
    throw new Error('Link must be to a valid feed (like a youtube channel)!');
  }
}

// DAILY_YOUTUBE_API_VOLUME
// YOUTUBE_QUERY_COST
// DAILY_YOUTUBE_API_VOLUME * subscriptions.length

async function tick() {
  let now = Date.now();
  let last_tick = await memory.get('subscriptions:last', now - 1000 * 60 * 60 * 24);
  await memory.set('subscriptions:last', now, 1000 * 60 * 60 * 24);
  
  let subscriptions = [];
  for (let guild of await discord.guilds_list()) {
    for (let channel of await discord.guild_channels_list(guild.id)) {
      for (let config of await memory.get(configkey(guild.id, channel.id), [])) {
        subscriptions.push({ guild_id: guild.id, channel_id: channel.id, config: config });
      }
    }
  }

  let total_cost = subscriptions.length * YOUTUBE_QUERY_COST;
  let contingent_per_second = DAILY_YOUTUBE_API_VOLUME * 0.5 / (60 * 60 * 24);
  let contingent = ((now - last_tick) / 1000) * contingent_per_second;
  let probability = contingent / total_cost;

  subscriptions = subscriptions.filter(_ => Math.random() < probability);

  return Promise.all(subscriptions.map(subscription => checkAndNotify(subscription.guild_id, subscription.channel_id, subscription.config)));
}

async function checkAndNotify(guild_id, channel_id, config) {
  let last_check_key = `subscriptions:last:guild:${guild_id}:channel:${channel_id}:feed:${config.feed}` + (config.filter ? ':filter:' + memory.mask(config.filter) : '');
  let now = Date.now() - 1000 * 60 * 5; // videos take some time to get fully released, lets give publishers some time to distribute to get reliable query results
  let last_check = await memory.get(last_check_key, undefined);
  if (!last_check) return memory.set(last_check_key, now, 60 * 60 * 24 * 7); // first time, nothing to do, just prepare for next time
  if (last_check >= now) throw new Error('Here be dragons (ticks too fast)');
  if (config.type != 'youtube') return; // for now this is the only supported type
  let items = await HTTP_YOUTUBE('/search', { part: 'snippet', type: 'video', channelId: config.feed, order: 'date', maxResults: 50, publishedAfter: new Date(last_check).toISOString(), publishedBefore: new Date(now - 1000).toISOString(), q: config.filter })
    .then(result => memory.set(last_check_key, now, 60 * 60 * 24 * 7).then(() => result))
    .then(result => result.items)
    .catch(error => error.message.includes('HTTP error 403') ? [] : null); // => 403 means we ran out of coins for the day ...
  if (items == null) {
    return discord.post(channel_id, `Subscription for https://www.youtube.com/channel/${config.feed} is broken!`);
  } else if (items.length == 0) {
    return;
  } else if (items.length == 1) {
    return discord.post(channel_id, `${items[0].snippet.channelTitle} has published **${items[0].snippet.title}**: https://www.youtube.com/watch?v=${items[0].id.videoId}.`);
  } else {
    return discord.post(channel_id, `${items[0].snippet.channelTitle} has published ${items.length} new videos: ` + items.map(item => `https://www.youtube.com/watch?v=${item.id.videoId}`).join(', ') + '.');
  }
}

async function HTTP_YOUTUBE(endpoint, parameters) {
  return curl.request({
      method: 'GET',
      hostname: 'www.googleapis.com',
      path: `/youtube/v3${endpoint}?key=${process.env.YOUTUBE_API_TOKEN}&` + Object.keys(parameters).filter(key => parameters[key]).map(key => `${key}=` + encodeURIComponent(parameters[key])).join('&'),
      cache: 60
    });
}

function configkey(guild_id, channel_id) {
  return `subscriptions:config:guild:${guild_id}:channel:${channel_id}`;
}

module.exports = { add, remove, tick }
