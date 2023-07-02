const memory = require('./memory.js');
const discord = require('./discord.js');
const ai = require('./ai.js');
const opentelemetry = require('@opentelemetry/api');

const meter = opentelemetry.metrics.getMeter('translator');
const translations_counter = meter.createCounter('translations');

async function configure_translate(guild_id, channel_id, language) {
  let key = memorykey(guild_id, channel_id);
  return language ? memory.set(key, language) : memory.unset(key);
}

const NONE_LANGUAGES = [
  'none',
  'internet slang',
  'mention',
  'discord mention',
  'emoji',
  'emoticon',
];

async function on_message_create(guild_id, channel_id, message_id, user_id, content) {
  if (content.trim() == '') return;
  let target_language = await memory.get(memorykey(guild_id, channel_id), await memory.get(memorykey(guild_id, '*'), null));
  if (!target_language) return;

  let models = await ai.getLanguageModels();
  let model = await ai.getDynamicModel(models);
  let model_fast = models[Math.max(0, models.findIndex(m => m.name == model.name)-1)];
  if (!ai.compareLanguageModelByCost(model_fast, model)) model_fast = model;

  if (ai.compareLanguageModelByPower(model_fast, { vendor: 'openai', name: 'gpt-4' })) {
    let is_target_language = await ai.createBoolean(model, user_id, `Is the text "${content}" ${target_language}?`, 0);
    //console.log(`DEBUG TRANSLATOR v2 #1 "${content}" => ${is_target_language}`);
    if (is_target_language) return;
  } else {
    let target_language_percentage = await ai.createResponse(model_fast, user_id, `What percentage of "${content}" is ${target_language}? Respond only with the percentage.`, 0);
    //console.log(`DEBUG TRANSLATOR v2 #1 "${content}" => ${target_language_percentage}`);
    if (!target_language_percentage) return;
    if (!target_language_percentage.endsWith('%')) throw new Error();
    target_language_percentage = parseFloat(target_language_percentage.substring(0, target_language_percentage.length - 1)) / 100;
    if (isNaN(target_language_percentage)) throw new Error();
    if (target_language_percentage > 0.9) return;
  }
  
  // gpt-3.5-turbo seems really bad at answering with exactly only the language, worse then older generation completion models!
  const dummy_token = 'NULL';
  let source_language = await ai.createCompletion(
    model.name != 'gpt-3.5-turbo' ? model : models[models.findIndex(m => m.name == 'gpt-3.5-turbo') - 1],
    user_id,
    `Determine the language of the text. Ignore typos. Respond with ${dummy_token} if no clear language can be determined.\nText: ${content}\nLanguage: `,
    0
  );
  //console.log(`DEBUG TRANSLATOR v2 #2 "${content}" is ${source_language}`);
  if (!source_language) return;
  if (source_language.endsWith('.')) source_language = source_language.substring(0, source_language.length - 1);
  if (source_language == dummy_token || source_language.startsWith(dummy_token)) return;
  if (source_language.split(',').some(language => language.split(' ').filter(token => token.length > 0).length > 3)) throw new Error('Invalid language: ' + source_language);
  if (source_language.toLowerCase().split(',').every(language => language == target_language.toLowerCase().trim() || NONE_LANGUAGES.some(none_language => language.includes(none_language)))) return;
  
  let translation = await translate(model, user_id, target_language, content)
  if (!translation) return;
  
  translations_counter.add(1, { 'language.target': target_language.substring(0, 1).toUpperCase() + target_language.substring(1).toLowerCase(), 'language.source': source_language });

  return discord.respond(channel_id, message_id, `(${source_language}) "${translation}"`, false).then(() => true);
}

async function translate(model, user, target_language, source) {
  const dummy_token = 'NULL';
  let prompt = `Translate the text to ${target_language}. `
    + `Do not translate emojis, hyperlinks, discord mentions, or any parts that are surrounded by : < or >. `
    + `Translate the text as ${dummy_token} if it is untranslatable or unnecessary to translate.\n`
    + `Text: "${source}"\n`
    + `Translation: `;
  let translation = await chatgpt.createCompletion(user, prompt, model, 0);
  //console.log(`DEBUG TRANSLATOR v2 #3 "${source}" => "${translation}"`);
  if (!translation || translation.length == 0) return;
  if (translation.startsWith('"') && translation.endsWith('"')) translation = translation.substring(1, translation.length - 1).trim();
  if (translation == dummy_token || translation.startsWith(dummy_token)) return;
  if (simplify(translation) == simplify(source)) return; // this can happen when something is valid in both language
  return translation;
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

module.exports = { configure_translate, on_message_create, translate }
