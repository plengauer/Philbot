const memory = require('./memory.js');
const discord = require('./discord.js');
const chatgpt = require('./openai.js');
const opentelemetry = require('@opentelemetry/api');

const meter = opentelemetry.metrics.getMeter('translator');
const translations_counter = meter.createCounter('translations');

async function configure_translate(guild_id, channel_id, language) {
  let key = memorykey(guild_id, channel_id);
  return language ? memory.set(key, language) : memory.unset(key);
}

async function on_message_create(guild_id, channel_id, message_id, content) {
  if (content.trim() == 0) return;
  let target_language = await memory.get(memorykey(guild_id, channel_id), await memory.get(memorykey(guild_id, '*'), null));
  if (!target_language) return;
  if (!await chatgpt.canCreate()) return;

  if (true) {
    let is_target_language = await chatgpt.createBoolean(`Is the text "${content}" ${target_language}?`, 'gpt-3.5-turbo');
    //console.log(`DEBUG TRANSLATOR v2 #1 "${content}" => ${is_target_language}`);
    if (is_target_language) return;
  } else {
    let target_language_percentage = await chatgpt.createResponse(`What percentage of "${content}" is ${target_language}? Respond only with the percentage.`, 'gpt-4');
    //console.log(`DEBUG TRANSLATOR v2 #1 "${content}" => ${target_language_percentage}`);
    if (!target_language_percentage) return;
    if (!target_language_percentage.endsWith('%')) throw new Error();
    target_language_percentage = parseFloat(target_language_percentage.substring(0, target_language_percentage.length - 1)) / 100;
    if (isNaN(target_language_percentage)) throw new Error();
    if (target_language_percentage > 0.9) return;
  }
  
  let source_language = await chatgpt.createCompletion(`Question: What language is the text "${content}"? Respond only with the language. Ignore typos.\nAnswer: `, 'gpt-4');
  //console.log(`DEBUG TRANSLATOR v2 #2 "${content}" is ${source_language}`);
  if (!source_language) return;
  if (source_language.endsWith('.') || source_language.split(',').some(language => language.split(' ').filter(token => token.length > 0).length > 3)) throw new Error('Invalid language: ' + language);
  if (source_language.toLowerCase().split(',').every(language => [target_language.toLowerCase().trim(), 'internet slang', 'mention', 'mentions', 'discord mention', 'discord mentions', 'emoji', 'emojis', 'emoticon', 'emoticons'].includes(language))) return;
  
  let translation = await chatgpt.createCompletion(`Translate the  text to ${target_language}. Do not translate emojis, or parts that are surrounded by : < or >. \nText: "${content}"\nTranslation: `, 'gpt-4');
  //console.log(`DEBUG TRANSLATOR v2 #3 "${content}" => "${translation}"`);
  if (!translation || translation.length == 0) return;
  if (translation.startsWith('"') && translation.endsWith('"')) translation = translation.substring(1, translation.length - 1);
  if (simplify(translation) == simplify(content)) throw new Error('Translation is equal to the source!');
  
  translations_counter.add(1, { 'language.target': target_language.substring(0, 1).toUpperCase() + target_language.substring(1).toLowerCase(), 'language.source': source_language });

  return discord.respond(channel_id, message_id, `(${source_language}) "${translation}"`, false);
}

function simplify(input) {
  let output = '';
  for (let index = 0; index < input.length; index++) {
    let char = input.charAt(index);
    output += /^\p{L}$/u.test(char) ? char : '_';
  }
  return output.toLowerCase().replace(/_/g, '').trim();
}

function memorykey(guild_id, channel_id) {
  return `translator:target_language:guild:${guild_id}:channel:${channel_id}`;
}

module.exports = { configure_translate, on_message_create }
