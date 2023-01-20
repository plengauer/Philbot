const process = require('process');
const memory = require('./memory.js');
const discord = require('./discord.js');
const curl = require('./curl.js');
const identity = require('./identity.js');

async function on_voice_state_update(guild_id, channel_id, session_id) {
  let me = await discord.me();
  let public_url = await identity.getPublicURL();
  return HTTP_VOICE('voice_state_update', { guild_id: guild_id, channel_id: channel_id, user_id: me.id, session_id: session_id, callback_url: public_url + '/discord/voice_callback' });
}

async function on_voice_server_update(guild_id, endpoint, token) {
  return HTTP_VOICE('voice_server_update', { guild_id: guild_id, endpoint: endpoint, token: token });
}

async function play(guild_id, user_id, voice_channel, search_string) {
  let links = await resolve_search_string(search_string);
  if (links.length > 1) {
    await prependAllToQueue(guild_id, links.slice(1));
  }
  return play0(guild_id, user_id, voice_channel, links[0]);
}

async function resolve_search_string(search_string) {
  if (search_string.includes('youtube.com/watch?v=')) {
    return [ search_string ];
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
    return youtube_links;
  } else {
    let result = await HTTP_YOUTUBE('/search', { part: 'snippet', type: 'video', order: 'rating', maxResults: 1, q: search_string })
    if (result.length == 0) throw new Error('No video found!');
    return [ 'https://www.youtube.com/watch?v=' + result.items[0].id.videoId ];
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
    voice_channel_id = (await discord.guild_channels_list(guild_id).then(channels => channels.find(channel => channel.name == voice_channel_name)))?.id;
    if (!voice_channel_id) throw new Error('I dont know the voice channel ' + voice_channel + '!');
  } else {
    if (user_id) voice_channel_id = (await memory.get(`voice_channel:user:${user_id}`, null))?.channel_id;
    if (!voice_channel_id) voice_channel_id = await memory.get(`player:voice_channel:guild:${guild_id}`, null);
  }
  if (!voice_channel_id) throw new Error('I dont know which voice channel to use!');
  await memory.set(`player:voice_channel:guild:${guild_id}`, voice_channel_id, 60 * 60 * 24);
  return HTTP_VOICE('voice_content_update', { guild_id: guild_id, url: youtube_link })
    //.then(() => discord.me())
    //.then(me => memory.get(`voice_channel:user:${me.id}`)) // that wont work, we can be in more than one channel!
    //.then(connection => connection?.channel_id != voice_channel_id ? discord.connect(guild_id, voice_channel_id) : undefined)
    .then(() => discord.connect(guild_id, voice_channel_id))
    .catch(error => error.message.includes('HTTP') && error.message.includes('403') ? Promise.reject(new Error('The video is unavailable (private)!')) : Promise.reject(error))
    .catch(error => error.message.includes('HTTP') && error.message.includes('451') ? Promise.reject(new Error('The video is unavailable (regional copy-right claims or age restriction)!')) : Promise.reject(error))
    .catch(error => error.message.includes('HTTP') && error.message.includes('404') ? Promise.reject(new Error('The video is unavailable!')) : Promise.reject(error))
}

async function HTTP_VOICE(operation, payload) {
  return curl.request({ secure: false, method: 'POST', hostname: `127.0.0.1`, port: process.env.VOICE_PORT ? parseInt(process.env.VOICE_PORT) : 12345, path: `/${operation}`, body: payload, timeout: 1000 * 60 * 60 * 24 });
}

async function stop(guild_id) {
  return discord.disconnect(guild_id);
}

async function pause(guild_id) {
  return HTTP_VOICE('voice_pause', { guild_id: guild_id });
}

async function resume(guild_id) {
  return HTTP_VOICE('voice_resume', { guild_id: guild_id });
}

async function popFromQueue(guild_id) {
  let queue = await getQueue(guild_id);
  if (queue.length == 0) return null;
  item = queue[0];
  await setQueue(guild_id, queue.slice(1));
  return item;
}

async function playNext(guild_id, user_id) {
  let next = await popFromQueue(guild_id);
  if (!next) return stop(guild_id).catch(ex => {/* just swallow exception */});
  try {
    await play(guild_id, user_id, null, next);
  } catch (error) {
    if (error.message.includes('video is unavailable')) return playNext(guild_id, user_id);
    else throw error;
  }

  const lookahead = 5;
  let successful_lookaheads = 0;
  let cursor = 0;
  while (successful_lookaheads < lookahead) {
    let lookaheads = (await getQueue(guild_id)).slice(cursor, cursor + lookahead - successful_lookaheads).filter(item => !!item);
    cursor += lookaheads.length;
    if (lookaheads.length == 0) break;
    lookaheads = await Promise.all(lookaheads.map(item => resolve_search_string(item).then(results => results[0]).then(link => link ? HTTP_VOICE('voice_content_lookahead', { guild_id: guild_id, url: link }).then(() => link) : null).catch(ex => null)));
    lookaheads = lookaheads.filter(item => !!item);
    successful_lookaheads += lookaheads.length;
  }
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
