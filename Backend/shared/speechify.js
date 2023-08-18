const process = require('process');
const memory = require('./memory.js');
const curl = require('./curl.js');
const synchronized = require('./synchronized.js');
const FormData = require('form-data');
const media = require('./media.js');

const token = process.env.SPEECHIFY_API_TOKEN;
const debug = false;

function getCostLimit() {
  return token ? parseFloat(process.env.SPEECHIFY_COST_LIMIT ?? '1') : 0;
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

async function createVoice(model, user, text, seed, format, report) {
  if (!token) return null;
  
  const buffer = false;
  if (buffer) {
    let chunks = [];
    let stream = seed;
    seed = await new Promise(resolve => {
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  const inline = true;
  if (inline) {
    let body = new FormData();
    body.append('text', text, { contentType: 'string' });
    body.append('files', seed, { contentType: 'audio/' + format });
    let response = await HTTP('POST', body.getHeaders(), '/tts/clone', body);
    await report(model, await getVoiceCost(text));
    return response;
  } else {
    let body_create = new FormData();
    body_create.append('name', user, { contentType: 'string' });
    body_create.append('files', seed, { contentType: 'audio/' + format });
    let response_create = await HTTP('POST', body_create.getHeaders(), '/voice', body_create);
    try {
      let body_clone = new FormData();
      body_clone.append('text', text, { contentType: 'string' });
      body_clone.append('voice_id', response_create.id, { contentType: 'string' });
      let response_clone = await HTTP('POST', body_clone.getHeaders(), '/tts/clone', body_clone);
      await report(model, await getVoiceCost(text));
      return response_clone;
    } finally {
      await HTTP('DELETE', {}, '/voice/' + response_create.id);
    }
  }
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
