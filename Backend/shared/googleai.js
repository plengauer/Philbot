const process = require('process');
const stream = require('stream');
const memory = require('./memory.js');
const curl = require('./curl.js');
const synchronized = require('./synchronized.js');
const media = require('./media.js');

const token = process.env.GCP_T2S_TOKEN;
const debug = false;

function getCostLimit() {
  return 1.00;
}

function isSameBillingSlot(t1, t2) {
  return t1.getUTCFullYear() == t2.getUTCFullYear() && t1.getUTCMonth() == t2.getUTCMonth();
}

function computeBillingSlotProgress() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const totalDaysInMonth = endOfMonth.getDate() - startOfMonth.getDate() + 1;
  const millisSinceStartOfMonth = now.getTime() - startOfMonth.getTime();
  return millisSinceStartOfMonth / (totalDaysInMonth * 1000 * 60 * 60 * 24);
}

async function getVoiceModels() {
  return [ "Standard", "Wavenet", "Neural2", "Polyglot", "Studio" ];
}

async function createVoice(model, text, language, gender, format, report) {
  if (!token) return null;
  let voice = await selectVoice(model, language, gender);
  try {
    let response = await HTTP({
      "audioConfig": {
        "audioEncoding": "MP3",
        "effectsProfileId": [ "headphone-class-device" ],
        "pitch": 0,
        "speakingRate": 1
      },
      "voice": { "languageCode": voice.languageCodes.find(languageCode => languageCode.includes(language)) ?? voice.languageCodes[0], "name": voice.name },
      "input": { "text": text }
    });
    await report(model, await getVoiceCost(model, text));
    let audio = new stream.PassThrough();
    audio.end(Buffer.from(response.audioContent, 'base64'));
    return media.convert(audio, "mp3", format);
  } catch (error) {
    if (error.message.startsWith('HTTP error 400') && error.stack.includes('Input size limit exceeded')) {
      let models = await getVoiceModels();
      let index = models.indexOf(model);
      if (index <= 0) throw error;
      return createVoice(models[index - 1], text, language, format, report);
    } else {
      throw error;
    }
  }
}

async function selectVoice(model, language, gender) {
  if (gender == 'neutral') gender = 'male';
  let models = await getVoiceModels();
  // preferences language -> gender -> model
  let voices = await getVoices(model, language, gender);
  if (voices.length > 0) return voices[0];
  for (let m of models.filter(m => models.indexOf(m) <= models.indexOf(model)).reverse()) {
    voices = await getVoices(m, language, gender);
    if (voices.length > 0) return voices[0];
  }
  for (let m of models.filter(m => models.indexOf(m) <= models.indexOf(model)).reverse()) {
    voices = await getVoices(m, language, false);
    if (voices.length > 0) return voices[0];
  }
  for (let m of models.filter(m => models.indexOf(m) <= models.indexOf(model)).reverse()) {
    voices = await getVoices(m, 'en', false);
    if (voices.length > 0) return voices[0];
  }
  throw new Error('No voice found!');
}

async function getVoices(model, language, gender) {
  return curl.request({
    hostname: 'texttospeech.googleapis.com',
    path: '/v1/voices' + '?key=' + token,
    headers: {},
    method: 'GET',
    timeout: 1000 * 10,
    cache: 1000 * 60 * 60 * 24
  }).then(result => result.voices)
  .then(voices => voices.filter(voice => !language || expandLanguageCodes(voice.languageCodes).includes(language)))
  .then(voices => voices.filter(voice => !model || voice.name.includes(model)))
  .then(voices => voices.filter(voice => !gender || voice.ssmlGender.toLowerCase() == gender.toLowerCase()));
}

function expandLanguageCodes(languageCodes) {
  return Array.from(new Set(languageCodes.map(languageCode => expandLanguageCode(languageCode)).reduce((a1, a2) => a1.concat(a2), [])));
}

function expandLanguageCode(languageCode) {
  let tags = languageCode.split('-');
  let result = [];
  for (let end = 1; end <= tags.length; end++) {
    result.push(tags.slice(0, end).join('-'));
  }
  return result;
}

function getVoice(model, language) {
  if (language != 'en-US') throw new Error();
  switch (model) {
    case 'Standard': return 'A';
    case  'Wavenet': return 'A';
    case  'Neural2': return 'A';
    case 'Polyglot': return '1';
    case   'Studio': return 'M';
    default: throw new Error('Unknown model: ' + model);
  }
}

async function getVoiceCost(model, text) {
  return synchronized.locked('googleai.cost:model:' + model, async () => getVoiceCost0(model, text));
}

async function getVoiceCost0(model, text) {
  let used = await getVoiceModelUsedCharacters(model);
  let max_free = getVoiceModelFreeCharacters(model);
  let non_free = used > max_free ? text.length : Math.max(0, used + text.length - max_free);
  await memory.set(voiceusedkey(model), { value: used + text.length, timestamp: Date.now() }, 60 * 60 * 24 * 31);
  return getVoiceModelCharacterCost(model) * non_free;
}

async function getVoiceModelUsedCharacters(model) {
    let now = new Date();
    let backup = { value: 0, timestamp: now };
    let used = await memory.get(voiceusedkey(model), backup);
    if (!isSameBillingSlot(new Date(used.timestamp), now)) used = backup;
    return used.value;
}

function voiceusedkey(model) {
    return 'googleai:used:model:' + model;
}

function getVoiceModelCharacterCost(model) {
  switch (model) {
    case 'Standard': return 0.000004;
    case  'Wavenet': return 0.000016;
    case  'Neural2': return 0.000016;
    case 'Polyglot': return 0.000016;
    case   'Studio': return 0.000160;
    default: throw new Error('Unknown model: ' + model);
  }
}

function getVoiceModelFreeCharacters(model) {
  switch (model) {
    case 'Standard': return 4 * 1000 * 1000;
    case  'Wavenet': return 1 * 1000 * 1000;
    case  'Neural2': return 1 * 1000 * 1000;
    case 'Polyglot': return 1 * 1000 * 1000;
    case   'Studio': return      100 * 1000;
    default: throw new Error('Unknown model: ' + model);
  }
}

async function HTTP(body) {
  let result = await curl.request({
    hostname: 'texttospeech.googleapis.com',
    path: '/v1/text:synthesize' + '?key=' + token,
    headers: {},
    method: 'POST',
    body: body,
    timeout: 1000 * 60 * 15
  });
  if (debug) console.log('DEBUG GOOGLEAI ' + JSON.stringify(body) + ' => ' + JSON.stringify(result));
  return result;
}

module.exports = {
  getCostLimit,
  isSameBillingSlot,
  computeBillingSlotProgress,
  
  getVoiceModels,
  createVoice
}
