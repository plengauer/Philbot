const process = require('process');
const memory = require('./memory.js');
const curl = require('./curl.js');
const synchronized = require('./synchronized.js');
const FormData = require('form-data');
const media = require('./media.js');

const token = process.env.SPEECHIFY_API_TOKEN;
const debug = false;

function getCostLimit() {
  return 0.00;
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
  return [ 'custom-voice-clone' ];
}

async function createVoice(model, text, seed, format, report) {
  if (!token) return null;
  let body = new FormData();
  body.append('text', text, { contentType: 'string' });
  body.append('files', seed, { contentType: 'audio/' + format });
  let response = await HTTP('GET', body.getHeaders(), '/tts/clone', body);
  await report(model, await getVoiceCost(text));
  return response;
}

async function getVoiceCost(text) {
  return synchronized.locked('speechify.cost', async () => getVoiceCost0(text));
}

async function getVoiceCost0(text) {
  let used = await getUsedCharacters();
  let max_free = 100000;
  let non_free = used > max_free ? text.length : Math.max(0, used + text.length - max_free);
  await memory.set(voiceusedkey(), { value: used + text.length, timestamp: Date.now() }, 60 * 60 * 24 * 31);
  return getVoiceCharacterCost() * non_free;
}

async function getUsedCharacters() {
    let now = new Date();
    let backup = { value: 0, timestamp: now };
    let used = await memory.get(voiceusedkey(), backup);
    if (!isSameBillingSlot(new Date(used.timestamp), now)) used = backup;
    return used.value;
}

async function getVoiceCharacterCost() {
  return 10 / 50000;
}

function voiceusedkey() {
    return 'speechify:used';
}

async function HTTP(method, headers, path, body) {
  headers['x-api-key'] = token;
  let result = await curl.request({
    hostname: 'myvoice.speechify.com',
    path: '/api' + path,
    headers: headers,
    method: method,
    body: body,
    timeout: 1000 * 60 * 15
  });
  if (debug) console.log('DEBUG SPEECHIFY ' + JSON.stringify(body) + ' => ' + JSON.stringify(result));
  return result;
}

module.exports = {
  getCostLimit,
  isSameBillingSlot,
  computeBillingSlotProgress,
  
  getVoiceModels,
  createVoice
}
