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
  let is_target_language = await chatgpt.getResponse(null, null, `Is "${content}" ${target_language}? Respond only with yes or no.`, "gpt-3.5-turbo");
  if (!is_target_language || is_target_language.toLowerCase().trim().includes('yes')) return;
  let source_language = await chatgpt.getResponse(null, null, `What language is "${content}"? Prefer ${target_language} if its ${target_language}. Respond only with the language. Ignore typos.`);
  if (!source_language || source_language.toLowerCase().trim() == target_language.toLowerCase().trim()) return;
  let translation = await chatgpt.getResponse(null, null, `Translate "${content}" to ${target_language}. Do not translate emojis, or parts that are surrounded by : < or >. Respond with the translation only, or nothing at all if the text is already in ${target_language} or untranslatable.`);
  if (!translation || translation.length == 0 || translation.trim() == content.trim()) return;
  return discord.respond(channel_id, message_id, `(${source_language}) "${translation}"`);
}

function memorykey(guild_id, channel_id) {
  return `translator:target_language:guild:${guild_id}:channel:${channel_id}`;
}

module.exports = { configure_translate, on_message_create }
