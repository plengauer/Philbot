const process = require('process');
const memory = require('./memory.js');
const discord = require('./discord.js');
const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');
const { google } = require('googleapis');
const youtube = google.youtube('v3');
const retry = require('./retry.js').retry;

async function markVoiceOperation(guild_id, ttl = 10) {
  return memory.set(`player:recent_voice_operation:guild:${guild_id}`, true, ttl);
}

async function hasRecentVoiceOperation(guild_id) {
  return memory.get(`player:recent_voice_operation:guild:${guild_id}`, false);
}

async function play0(guild_id, user_id, voice_channel, youtube_link) {
  let voice_channel_id = null;
  if (voice_channel) {
    for (const channel of await discord.guild_channels_list(guild_id)) {
      if (channel.name === voice_channel) {
        voice_channel_id = channel.id;
        break;
      }
    }
    if (!voice_channel_id) {
      return 1;
    }
  } else {
    if (user_id) {
      voice_channel_id = (await memory.get(`voice_channel:user:${user_id}`, null))?.channel_id;
    }
    if (!voice_channel_id) {
      voice_channel_id = await memory.get(`player:voice_channel:guild:${guild_id}`, null);
    }
  }
  if (!voice_channel_id) {
    return 2;
  }
  
  try {
    await discord.voice_track_play(guild_id, voice_channel_id, await ytdl.getInfo(youtube_link));
  } catch (e) {
    if ((e.stack.includes('Status code: 410') || e.stack.includes('Video unavailable') || e.stack.includes('private video'))) {
      return 5;
    } else {
      throw e;
    }
  }
  return Promise.all([
    memory.set(`player:voice_channel:guild:${guild_id}`, voice_channel_id, 60 * 60 * 24),
    markVoiceOperation(guild_id)
  ]).then(() => 0);
}

async function play(guild_id, user_id, voice_channel, search_string) {
  if (search_string.includes('youtube.com/watch?v=')) {
    return play0(guild_id, user_id, voice_channel, search_string);
  } else if (search_string.includes('youtube.com/playlist?list=')) {
    let list = search_string.split('list=')[1]; // be brave!
    let items = [];
    let pageToken = null;
    do {
      let result = (await youtube.playlistItems.list({
        auth: process.env.YOUTUBE_API_TOKEN,
        playlistId: list,
        part: 'snippet',
        maxResults: 1000,
        pageToken: pageToken
      })).data;
      items = items.concat(result.items);
      pageToken = result.nextPageToken;
    } while(pageToken != null && pageToken.length > 0);
    if (items.length == 0) {
      return 3;
    }
    youtube_links = [];
    for (let index = 0; index < items.length; index++) {
      youtube_links.push('https://www.youtube.com/watch?v=' + items[index].snippet.resourceId.videoId);
    }
    await prependAllToQueue(guild_id, youtube_links.slice(1));
    return play0(guild_id, user_id, voice_channel, youtube_links[0]);
  } else {
    let results = await ytSearch(search_string);
    if (!results?.all?.length) {
      return 4;
    }
    for (let index = 0; index < results.all.length && index < 5; index++) {
      let result = await play0(guild_id, user_id, voice_channel, results.all[index].url);
      if (result != 5) return result;
    }
    return 5;
  }
}

async function stop(guild_id) {
  return markVoiceOperation(guild_id, 60)
    .then(() => { throw new Error('Not implemented! (VOICE DISCONNECT)'); });
}

async function pause(guild_id) {
  return markVoiceOperation(guild_id, 60 * 60)
    .then(() => { throw new Error('Not implemented! (VOICE PAUSE)'); });
    // at some point it automatically disconnects, and thats ok
}

async function resume(guild_id) {
  throw new Error('Not implemented! (VOICE RESUME)');
    //.then(() => markVoiceOperation(guild_id));
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

async function clearQueue0(guild_id, id) {
  return memory.unset(`music_queue:guild:${guild_id}:part:${id}`);
}

async function getQueue0(guild_id, id) {
  return memory.get(`music_queue:guild:${guild_id}:part:${id}`, []);
}

async function setQueue0(guild_id, id, queue) {
  return memory.set(`music_queue:guild:${guild_id}:part:${id}`, queue, 60 * 60 * 12);
}

async function clearQueue(guild_id) {
  for (let id = 0;; id++) {
    let part = await getQueue0(guild_id, id);
    if (part.length == 0) {
      break;
    }
    await clearQueue0(guild_id, id);
  }
}

async function getQueue(guild_id) {
  let queue = [];
  for (let id = 0;; id++) {
    let part = await getQueue0(guild_id, id);
    if (part.length == 0) {
      break;
    }
    queue = queue.concat(part);
  }
  return queue;
}

async function setQueue(guild_id, queue) {
  let max_elements = 250;
  let id = 0;
  while (queue.length > 0) {
    let part = queue.slice(0, max_elements);
    await setQueue0(guild_id, id++, part);
    queue = queue.slice(part.length);
  }
  return clearQueue0(guild_id, id++);
}

module.exports = { hasRecentVoiceOperation, play, stop, pause, resume, playNext, appendToQueue, shuffleQueue, clearQueue, getQueue }
