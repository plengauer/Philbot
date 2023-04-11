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
  if (!chatgpt.canGetResponse()) return;
  let prompt = `Translate "${content}" to ${target_language}. Do not translate emojis, or parts that are surrounded by : < or >. Respond with the translation only, or nothing at all if the text is already in ${target_language} or untranslatable.`;
  let translation = await chatgpt.getResponse(null, null, prompt);
  if (!translation || translation.length == 0 || translation.trim() == content.trim()) return;
  return discord.respond(channel_id, message_id, `"${translation}"`);
}

function memorykey(guild_id, channel_id) {
  return `translator:target_language:guild:${guild_id}:channel:${channel_id}`;
}

module.exports = { configure_translate, on_message_create }
