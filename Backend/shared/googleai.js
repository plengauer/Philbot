const process = require('process');
const memory = require('./memory.js');
const curl = require('./curl.js');
const synchronized = require('./synchronized.js');
const media = require('./media.js');

const token = process.env.GCP_API_KEY;

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

async function createVoice(model, text, language, format, report) {
  if (!token) return null;
  let voice = getVoice(model, language);
  // https://cloud.google.com/text-to-speech/docs/reference/rest
  let response = await HTTP({
    "audioConfig": {
      "audioEncoding": "MP3",
      "effectsProfileId": [ "headphone-class-device" ],
      "pitch": 0,
      "speakingRate": 1
    },
    "voice": { "languageCode": language, "name": `${language}-${model}-${voice}` },
    "input": { "text": text }
  });
  await report(model, await getVoiceCost(model, text));
  return media.convert(Buffer.from(response.audioContent, 'base64'), "mp3", format);
}

function getVoice(model, language) { // TODO we could use https://cloud.google.com/text-to-speech/docs/reference/rest/v1/voices
  if (language != 'en-US') throw new Error(); // TODO
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
  await memory.set(voiceusedkey(model), { value: used, timestamp: Date.now() }, 60 * 60 * 24 * 31);
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
    path: '/v1/text:synthesize',
    headers: { 'Authorization': token }, //TODO bearer?
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
