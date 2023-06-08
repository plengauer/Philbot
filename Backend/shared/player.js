const process = require('process');
const url = require('url');
const memory = require('./memory.js');
const discord = require('./discord.js');
const curl = require('./curl.js');

async function on_voice_state_update(guild_id, channel_id, session_id) {
  if (channel_id) await memory.set(`player:voice_channel:guild:${guild_id}`, channel_id, 60 * 60 * 24);
  let me = await discord.me();
  return HTTP_VOICE('voice_state_update', { guild_id: guild_id, channel_id: channel_id, user_id: me.id, session_id: session_id, callback_url: 'http://127.0.0.1:8080/voice_callback' })
    .then(() => updateInteractions(guild_id));
}

async function on_voice_server_update(guild_id, endpoint, token) {
  return HTTP_VOICE('voice_server_update', { guild_id: guild_id, endpoint: endpoint, token: token })
    .then(() => updateInteractions(guild_id));
}

async function play(guild_id, channel_id, search_string) {
  let links = await resolve_search_string(search_string);
  if (links.length > 1) {
    await prependAllToQueue(guild_id, links.slice(1));
  }
  return play0(guild_id, channel_id, links[0]);
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
    // alternative orderings are "rating" (but thats a relative number where unimportant videos show up first) or "viewCount"
    let result = await HTTP_YOUTUBE('/search', { part: 'snippet', type: 'video', order: 'relevance', maxResults: 1, q: search_string })
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

async function play0(guild_id, channel_id, youtube_link) {
  channel_id = channel_id ?? await memory.get(`player:voice_channel:guild:${guild_id}`, undefined);
  if (!channel_id) throw new Error('I don\'t know which channel to use!');
  // cant do this in parallel because the error from resolving the link should be the prominent error in case
  return VOICE_CONTENT(guild_id, youtube_link)
    .then(() => isConnected(guild_id, channel_id).then(connected => connected ? Promise.resolve() : discord.connect(guild_id, channel_id)))
    .then(() => resolveTitle(youtube_link).then(title => memory.set(`player:title:guild:${guild_id}`, title, 60 * 60 * 24)).then(() => updateInteractions(guild_id)));
}

async function isConnected(guild_id, channel_id) {
  return HTTP_VOICE('voice_is_connected', { guild_id: guild_id, channel_id: channel_id }).then(connected => connected == 'true').catch(() => false);
}

async function VOICE_CONTENT(guild_id, link, lookahead_only = false, title = undefined, retries = 10, unavailable_links = []) {
  // HTTP_YOUTUBE('/search', { part: 'snippet', type: 'video', relatedToVideoId: 'video' })
  return HTTP_VOICE(lookahead_only ? 'voice_content_lookahead' : 'voice_content_update', { guild_id: guild_id, url: link })
    .catch(error => error.message.includes('HTTP') && error.message.includes('403') ? Promise.reject(new Error('The video is unavailable (private)!')) : Promise.reject(error))
    .catch(error => error.message.includes('HTTP') && error.message.includes('451') ? Promise.reject(new Error('The video is unavailable (regional copy-right claims or age restriction)!')) : Promise.reject(error))
    .catch(error => error.message.includes('HTTP') && error.message.includes('404') ? Promise.reject(new Error('The video is unavailable!')) : Promise.reject(error))
    .catch(error => error.message.includes('video is unavailable') && retries > 0
      ? (title ? Promise.resolve(title) : resolveTitle(link))
        .then(title => HTTP_YOUTUBE('/search', { part: 'snippet', type: 'video', order: 'relevance', maxResults: 50, q: title })
          .then(result => result.items.map(item => 'https://www.youtube.com/watch?v=' + item.id.videoId))
          .then(links => links.filter(backup => backup != link && !unavailable_links.includes(backup)))
          .then(links => links.length > 0 ? links[0] : null)
          .then(backup => backup ? VOICE_CONTENT(guild_id, backup, lookahead_only, title, retries - 1, unavailable_links.concat([ link ])) : Promise.reject(error))
        )
        .catch(() => Promise.reject(error))
      : Promise.reject(error)
    );
}

async function HTTP_VOICE(operation, payload) {
  return curl.request({ secure: false, method: 'POST', hostname: `127.0.0.1`, port: process.env.VOICE_PORT ? parseInt(process.env.VOICE_PORT) : 12345, path: `/${operation}`, headers: { 'x-authorization': process.env.DISCORD_API_TOKEN }, body: payload, timeout: 1000 * 60 * 60 * 24 });
}

async function resolveTitle(link) {
  return HTTP_YOUTUBE('/videos', { part: 'snippet', id: url.parse(link, true).query['v'] }).then(result => result.items[0].snippet.title);
}

async function stop(guild_id) {
  return on_voice_state_update(guild_id, null, null) // simulate a stop event so that, in case events arrive in the wrong order, they dont cause a reconnect
    .then(() => discord.disconnect(guild_id))
    .then(() => memory.unset(`player:title:guild:${guild_id}`))
    .then(() => memory.unset(`player:paused:guild:${guild_id}`))
    .then(() => closeInteractions(guild_id));
}

async function pause(guild_id) {
  return HTTP_VOICE('voice_pause', { guild_id: guild_id })
    .then(() => memory.set(`player:paused:guild:${guild_id}`, true, 60 * 60 * 24))
    .then(() => updateInteractions(guild_id));
}

async function resume(guild_id) {
  return HTTP_VOICE('voice_resume', { guild_id: guild_id })
    .then(() => memory.set(`player:paused:guild:${guild_id}`, false, 60 * 60 * 24))
    .then(() => updateInteractions(guild_id));
}

async function popFromQueue(guild_id) {
  let queue = await getQueue(guild_id);
  if (queue.length == 0) return null;
  item = queue[0];
  await setQueue(guild_id, queue.slice(1));
  return item;
}

async function playNext(guild_id, channel_id) {
  let next = await popFromQueue(guild_id);
  if (!next) return stop(guild_id).catch(ex => {/* just swallow exception */});
  try {
    await play(guild_id, channel_id, next);
  } catch (error) {
    if (error.message.includes('video is unavailable')) return playNext(guild_id, channel_id);
    else throw error;
  }

  const lookahead = 5;
  let successful_lookaheads = 0;
  let cursor = 0;
  while (successful_lookaheads < lookahead) {
    let lookaheads = (await getQueue(guild_id)).slice(cursor, cursor + lookahead - successful_lookaheads).filter(item => !!item);
    cursor += lookaheads.length;
    if (lookaheads.length == 0) break;
    lookaheads = await Promise.all(lookaheads.map(item => resolve_search_string(item).then(results => results[0]).then(link => link ? VOICE_CONTENT(guild_id, link, true).then(() => link) : null).catch(ex => null)));
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
  return memory.unset(`music_queue:guild:${guild_id}`)
    .then(() => updateInteractions(guild_id));
}

async function getQueue(guild_id) {
  return memory.get(`music_queue:guild:${guild_id}`, []);
}

async function setQueue(guild_id, queue) {
  return memory.set(`music_queue:guild:${guild_id}`, queue, 60 * 60 * 12)
    .then(() => updateInteractions(guild_id));
}

async function openInteraction(guild_id, channel_id) {
  if (!guild_id) throw new Error();
  let interaction_message = await discord.post(channel_id, 'Initializing ...', undefined, false);
  let interaction_info = await memory.get(interactionkey(guild_id), {});
  if (interaction_info[channel_id]) await discord.message_delete(channel_id, interaction_info[channel_id]).catch(() => {});
  interaction_info[channel_id] = interaction_message.id;
  await memory.set(interactionkey(guild_id), interaction_info);
  await memory.set(interactionreversekey(interaction_message.id), guild_id);
  return updateInteractions(guild_id);
}

async function onInteraction(guild_id, channel_id, message_id, interaction_id, interaction_token, data) {
  guild_id = guild_id ?? await memory.get(interactionreversekey(message_id), null);
  if (!guild_id) throw new Error();
  switch(data.custom_id) {
    case 'player.resume': return resume(guild_id).then(() => discord.interact(interaction_id, interaction_token));
    case 'player.pause': return pause(guild_id).then(() => discord.interact(interaction_id, interaction_token));
    case 'player.stop': return stop(guild_id).then(() => discord.interact(interaction_id, interaction_token));
    case 'player.toggle': return memory.get(`player:paused:guild:${guild_id}`, false).then(paused => paused ? resume(guild_id) : pause(guild_id)).then(() => discord.interact(interaction_id, interaction_token));
    case 'player.next': return discord.interact(interaction_id, interaction_token).then(() => playNext(guild_id, undefined));
    case 'player.play.modal': return discord.interact(interaction_id, interaction_token, {
      type: 9,
      data: {
        "title": "Play",
        "custom_id": "player.play",
        "components": [{
          "type": 1,
          "components": [{
            "type": 4,
            "custom_id": "player.query",
            "label": "Link or Search Query",
            "style": 1,
            "min_length": 5,
            "max_length": 4000,
            "placeholder": "Rick Astley - Never Gonna Give You Up",
            "required": true
          }]
        }]
      }
    });
    case 'player.play': return discord.interact(interaction_id, interaction_token).then(() => play(guild_id, undefined, data.components[0].components[0].value));
    case 'player.shuffle': return shuffleQueue(guild_id).then(() => discord.interact(interaction_id, interaction_token));
    case 'player.repeat': return discord.interact(interaction_id, interaction_token); //TODO implement me
    case 'player.append.modal': return discord.interact(interaction_id, interaction_token, {
      type: 9,
      data: {
        "title": "Append",
        "custom_id": "player.append",
        "components": [{
          "type": 1,
          "components": [{
            "type": 4,
            "custom_id": "player.query",
            "label": "Link or Search Query",
            "style": 1,
            "min_length": 5,
            "max_length": 4000,
            "placeholder": "Rick Astley - Never Gonna Give You Up",
            "required": true
          }]
        }]
      }
    });
    case 'player.append': return appendToQueue(guild_id, data.components[0].components[0].value).then(() => discord.interact(interaction_id, interaction_token));
    case 'player.clear': return clearQueue(guild_id).then(() => discord.interact(interaction_id, interaction_token));
    default: throw new Error('Unknown interaction: ' + data.custom_id);
  }
}

async function closeInteractions(guild_id) {
  let interaction_info = await memory.consume(interactionkey(guild_id), {});
  return Promise.all(Object.keys(interaction_info).map(channel_id => discord.message_delete(channel_id, interaction_info[channel_id]).catch(() => {}).then(() => memory.unset(interactionreversekey(interaction_info[channel_id])))));
}

async function updateInteractions(guild_id) {
  let title = await memory.get(`player:title:guild:${guild_id}`, null);
  let text = title ? `Playing **${title}**` : '';
  let interaction_info = await memory.get(interactionkey(guild_id), {});
  let components = await createInteractionComponents(guild_id);
  return Promise.all(Object.keys(interaction_info).map(channel_id => discord.message_update(channel_id, interaction_info[channel_id], text, [], components)));
}

async function createInteractionComponents(guild_id) {
  let paused = await memory.get(`player:paused:guild:${guild_id}`, false);
  let connected = await isConnected(guild_id, null);
  let hasNext = (await getQueue(guild_id)).length > 0;
  if (true) {
    return [
      {
        type: 1,
        components: [
          { type: 2, style: 2, label: '', emoji: { name: '🎵' }, custom_id: 'player.play.modal', disabled: false },
          { type: 2, style: 2, label: '', emoji: { name: '⏯️' }, custom_id: 'player.toggle', disabled: !connected },
          { type: 2, style: 2, label: '', emoji: { name: '⏩' }, custom_id: 'player.next', disabled: !hasNext },
          { type: 2, style: 2, label: '', emoji: { name: '⏹️' }, custom_id: 'player.stop', disabled: !connected }
        ]
      },
      {
        type: 1,
        components: [
          { type: 2, style: 2, label: '', emoji: { name: '🔀' }, custom_id: 'player.shuffle', disabled: !hasNext },
          { type: 2, style: 2, label: '', emoji: { name: '🔁' }, custom_id: 'player.repeat', disabled: !connected },
          { type: 2, style: 2, label: '', emoji: { name: '➕' }, custom_id: 'player.append.modal', disabled: false },
          { type: 2, style: 2, label: '', emoji: { name: '🗑️' }, custom_id: 'player.clear', disabled: !hasNext },
        ]
      }
    ];
  } else {
    return [{ type: 1, components: [
      { type: 2, style: 1, label: 'Play', custom_id: 'player.play.modal', disabled: false },
      { type: 2, style: 2, label: 'Resume', custom_id: 'player.resume', disabled: !paused },
      { type: 2, style: 2, label: 'Pause', custom_id: 'player.pause', disabled: paused },
      { type: 2, style: 1, label: 'Next', custom_id: 'player.next', disabled: !hasNext },
      { type: 2, style: 3, label: 'Stop', custom_id: 'player.stop', disabled: connected }
    ]}];
  }
}

function interactionkey(guild_id) {
  return `player:interactions:guild:${guild_id}`;
}

function interactionreversekey(message_id) {
  return `player:interaction:message:${message_id}`;
}

module.exports = { on_voice_state_update, on_voice_server_update, play, stop, pause, resume, playNext, appendToQueue, shuffleQueue, clearQueue, getQueue, openInteraction, onInteraction }
