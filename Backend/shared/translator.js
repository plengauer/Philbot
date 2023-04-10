const memory = require('./memory.js');
const discord = require('./discord.js');
const chatgpt = require('./chatgpt.js');

async function configure_translate(guild_id, channel_id, language) {
  let key = memorykey(guild_id, channel_id);
  return language ? memory.set(key, language) : memory.unset(key);
}

async function on_message_create(guild_id, channel_id, message_id, content) {
  let target_language = await memory.get(memorykey(guild_id, channel_id), null);
  if (!target_language) return;
  let backup = 'NULL';
  let translation = await chatgpt.getResponse(null, null, `Translate "${content}" to ${target_language}. If the text is already in that language, respond with only "${backup}".`, "gpt-3.5-turbo");
  if (translation == backup || translation.startsWith(backup) || translation == `"${backup}"` || translation.startsWith(`"${backup}"`)) return;
  target_language = target_language.substring(0, 1).toUpperCase() + target_language.substring(1).toLowerCase();
  return discord.respond(channel_id, message_id, `${target_language}: ${translation}`);
}

function memorykey(guild_id, channel_id) {
  return `translator:target_language:guild:${guild_id}:channel:${channel_id}`;
}

module.exports = { configure_translate, on_message_create }
