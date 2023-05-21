
const openai = require('../../shared/openai.js');
const translator = require('../../shared/translator.js');
const discord = require('../../shared/discord.js');

async function handle() {
  // just for debugging
  const guild_id = '977181350509555752';
  const channel_id = '1105496810560167966';
  const message_id = undefined;
  const tests = [
    // regular messages
    { text: 'Hello, how are you?', language: 'english' },
    { text: 'I am sleepy!', language: 'english' },
    { text: 'Bonjour, je mange baguette.', language: 'french' },
    { text: 'Ich liebe dich.', language: 'german' },
    { text: 'Olen uninen.', language: 'finnish' },
    // regular messages with typos
    { text: 'Helo, how are youuuuu?', language: 'english' },
    { text: 'Ich lieb dih.', language: 'german' },
    // double languages
    { text: 'I am sleepy! Olen uninen.', language: 'english, finnish' },
    { text: 'Ich liebe dich. Bonjour, je mange baguette.', language: 'german, french' },
    // links, mentions, emojis
    { text: ':thumbsup:', language: undefined },
    { text: '<@928927613269987369>', language: undefined },
    { text: '<@&928927613269987369>', language: undefined },
    { text: 'https://tenor.com/view/nick-young-question-mark-huh-what-confused-gif-4995479', language: undefined },
    { text: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&pp=ygULcmljayBhc3RsZXk%3D', language: undefined },
    // languages with embedded discord mentions and emojis, and ""
    { text: 'Did you tell <@928927613269987369> about it?', language: 'english' },
    { text: 'Thats funny! :rolf:', language: 'english' },
    { text: 'He said "i am the best" but i killed him', language: 'english' },
    // some internet stuff
    { text: 'bruh', language: undefined },
    { text: 'xD', language: undefined },
    { text: 'xDDddd', language: undefined },
    { text: ':)', language: undefined },
    { text: 'lol', language: undefined }
  ];
  const languages = [ 'english', 'french', 'german', 'finnish' ];
  let model_tests_succeeded = {};
  let model_tests_failed = {};
  for (let model of openai.getLanguageModels().reverse().slice(0, 2).filter(model => model == 'gpt-3.5-turbo')) {
    process.env['OPENAI_DYNAMIC_MODEL_OVERRIDE'] = model;
    model_tests_succeeded[model] = 0;
    model_tests_failed[model] = 0;
    for (let language of languages) {
      await translator.configure_translate(guild_id, channel_id, language);
      for (let test of tests) {
        let message = await discord.post(channel_id, `**Translation Test**\nModel: ${model}\nTarget Language: ${language}\nMessage: ${test.text}`);
        try {
          let translated = await translator.on_message_create(guild_id, channel_id, message.id, test.text);
          if ((!test.language && translated) || (test.language && !!translated != (test.language != language))) {
            await discord.respond(channel_id, message.id, `**TEST FAILED**`);
            model_tests_failed[model]++;
          } else {
            model_tests_succeeded[model]++;
          }
        } catch (error) {
          await discord.respond(channel_id, message.id, `**TEST FAILED**:\n${error.stack}`);
          model_tests_failed[model]++;
        }
      }
      await translator.configure_translate(guild_id, channel_id, null);
    }
  }
  await discord.post(channel_id, `**TEST SUMMARY**\n`
    + openai.getLanguageModels().map(model => `${model}: ` + ((model_tests_succeeded[model] / (model_tests_succeeded[model] + model_tests_failed[model])) * 100) + '%').join('\n')
  );
}

module.exports = { handle };