const process = require('process');
const memory = require('./memory.js');
const discord = require('./discord.js');
const curl = require('./curl.js');
const retry = require('./retry.js').retry;

async function on_voice_state_update(guild_id, channel_id, session_id) {
  return discord.me()
    .then(me => HTTP_VOICE('voice_state_update', { guild_id: guild_id, channel_id: channel_id, user_id: me.id, session_id: session_id }))
}

async function on_voice_server_update(guild_id, endpoint, token) {
  return HTTP_VOICE('voice_server_update', { guild_id: guild_id, endpoint: endpoint, token: token });
}

async function play(guild_id, user_id, voice_channel, search_string) {
  if (search_string.includes('youtube.com/watch?v=')) {
    return play0(guild_id, user_id, voice_channel, search_string);
  } else if (search_string.includes('youtube.com/playlist?list=')) {
    let items = [];
    let pageToken = null;
    do {
      let result = await HTTP_YOUTUBE('/playlistItems', { part: 'snippet', maxResults: 1000, pageToken: pageToken, playlistId: search_string.split('list=')[1] });
      items = items.concat(result.items);
      pageToken = result.nextPageToken;
    } while(pageToken != null && pageToken.length > 0);
    if (items.length == 0) {
      throw new Error('The playlist is empty!');
    }
    youtube_links = [];
    for (let index = 0; index < items.length; index++) {
      youtube_links.push('https://www.youtube.com/watch?v=' + items[index].snippet.resourceId.videoId);
    }
    await prependAllToQueue(guild_id, youtube_links.slice(1));
    return play0(guild_id, user_id, voice_channel, youtube_links[0]);
  } else {
    let result = await HTTP_YOUTUBE('/search', { part: 'snippet', type: 'video', order: 'rating', maxResults: 1, q: search_string })
    if (result.length == 0) throw new Error('No video found!');
    return play0(guild_id, user_id, voice_channel, results.items[0].id.videoId);
  }
}

async function HTTP_YOUTUBE(endpoint, parameters) {
  return curl.request({
      method: 'GET',
      hostname: 'www.googleapis.com',
      path: `/youtube/v3${endpoint}?key=${process.env.YOUTUBE_API_TOKEN}&` + Object.keys(parameters).filter(key => parameters[key]).map(key => `${key}=` + encodeURIComponent(parameters[key])).join('&'),
      cache: 60 * 60 * 24
    });
}

async function play0(guild_id, user_id, voice_channel_name, youtube_link) {
  let voice_channel_id = null;
  if (voice_channel_name) {
    voice_channel_id = await discord.guild_channels_list(guild_id).then(channels => channels.find(channel => channel.name == voice_channel_name));
    if (!voice_channel_id) throw new Error('I dont know the voice channel ' + voice_channel + '!');
  } else {
    if (user_id) voice_channel_id = (await memory.get(`voice_channel:user:${user_id}`, null))?.channel_id;
    if (!voice_channel_id) voice_channel_id = await memory.get(`player:voice_channel:guild:${guild_id}`, null);
  }
  if (!voice_channel_id) throw new Error('I dont know which voice channel to use!');
  await memory.set(`player:voice_channel:guild:${guild_id}`, voice_channel_id, 60 * 60 * 24);
  return HTTP_VOICE('voice_content_update', { guild_id: guild_id, url: youtube_link })
    .then(() => discord.me())
    .then(me => memory.get(`voice_channel:user:${me.id}`))
    .then(channel_id => channel_id != voice_channel_id ? { command: 'voice connect', guild_id: guild_id, channel_id: voice_channel_id } : undefined);
}

async function HTTP_VOICE(operation, payload) {
  return curl.request({ secure: false, method: 'POST', hostname: `127.0.0.1`, port: process.env.VOICE_PORT ? parseInt(process.env.VOICE_PORT) : 12345, path: `/${operation}`, body: payload, timeout: 1000 * 60 * 60 * 24 });
}

async function stop(guild_id) {
  return { command: 'voice disconnect', guild_id: guild_id };
}

async function pause(guild_id) {
  throw new Error('Not implemented! (VOICE PAUSE)');
}

async function resume(guild_id) {
  throw new Error('Not implemented! (VOICE RESUME)');
}

async function popFromQueue(guild_id) {
  let queue = await getQueue(guild_id);
  if (queue.length == 0) return null;
  item = queue[0];
  await setQueue(guild_id, queue.slice(1));
  return item;
}

async function playNext(guild_id, user_id) {
  return retry(() => 
    popFromQueue(guild_id)
      .then(item => item ?
        play(guild_id, user_id, null, item) :
        stop(guild_id).catch(ex => {/* just swallow exception */}).then(() => 6)
      ).then(result => {
        if (result == 5) throw 5; // to trigger retry on video not available
        return result;
      })
  );
}

async function appendToQueue(guild_id, item) {
  return getQueue(guild_id).then(queue => setQueue(guild_id, queue.concat([ item ])));
}

async function prependAllToQueue(guild_id, items) {
  return getQueue(guild_id).then(queue => setQueue(guild_id, items.concat(queue)));
}

async function shuffleQueue(guild_id) {
  let queue = await getQueue(guild_id);
  for (let i = 0; i < queue.length * queue.length; i++) { // this could be much more intelligent, but it seems to be good enough
    let index_0 = Math.floor(Math.random() * queue.length);
    let index_1 = Math.floor(Math.random() * queue.length);
    let tmp = queue[index_0];
    queue[index_0] = queue[index_1];
    queue[index_1] = tmp;
  }
  return setQueue(guild_id, queue);
}

async function clearQueue(guild_id) {
  return memory.unset(`music_queue:guild:${guild_id}`);
}

async function getQueue(guild_id) {
  return memory.get(`music_queue:guild:${guild_id}`, []);
}

async function setQueue(guild_id, queue) {
  return memory.set(`music_queue:guild:${guild_id}`, queue, 60 * 60 * 12);
}

module.exports = { on_voice_state_update, on_voice_server_update, play, stop, pause, resume, playNext, appendToQueue, shuffleQueue, clearQueue, getQueue }
