const process = require('process');
const memory = require('./memory.js');
const curl = require('./curl.js');
const synchronized = require('./synchronized.js');

const token = process.env.GCP_API_KEY;

function getCostLimit() {
  return 0.00;
}

function isSameBillingSlot(t1, t2) {
  return  t1.getUTCFullYear() == t2.getUTCFullYear() && t1.getUTCMonth() == t2.getUTCMonth();
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

async function createVoice(model, text, language) {
  if (!token) return null;
  let voice = getVoice(model, language);
  return HTTP({
    "audioConfig": {
      "audioEncoding": "LINEAR16",
      "effectsProfileId": [ "headphone-class-device" ],
      "pitch": 0,
      "speakingRate": 1
    },
    "input": { "text": text },
    "voice": { "languageCode": language, "name": `${language}-${model}-${voice}` }
  });
}

function getVoice(model, language) {
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

function getVoiceCost(model, text) {
  switch (model) {
    default: throw new Error('Unknown model: ' + model);
  }
}

async function HTTP(body) {
  let result = await curl.request({
    hostname: 'us-central1-texttospeech.googleapis.com',
    path: '/v1beta1/text:synthesize',
    headers: { 'Authorization': token }, //TODO bearer?
    method: 'POST',
    body: body,
    timeout: 1000 * 60 * 15
  });
  if (debug) console.log('DEBUG GOOGLEAI ' + JSON.stringify(body) + ' => ' + JSON.stringify(result));
  return result;
}

async function bill(cost, model, user) {
  return synchronized.locked('googleai.billing', () => {
    throw new Error('Implement me!');
  });
}

module.exports = {
  getCostLimit,
  isSameBillingSlot,
  computeBillingSlotProgress,
  
  getVoiceModels,
  createVoice
}
