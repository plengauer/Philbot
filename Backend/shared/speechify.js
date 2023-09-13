const process = require('process');
const url = require('url');
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

async function getVoiceModels(user) {
  return resolveVoice(user).then(voice => voice ? [ voice.name ] : []);
}

async function seedVoice(model, user, seed, format) {
  if (!token) return null;
  const buffer = true;
  if (buffer) {
    let chunks = [];
    let stream = seed;
    seed = await new Promise(resolve => {
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }
  let body = new FormData();
  body.append('name', user, { contentType: 'string' });
  body.append('files', seed, { contentType: 'video/' + format, filename: 'voice_sample.' + user + '.' + format });
  return await HTTP('POST', body.getHeaders(), '/voice', body); //TODO this errors with 405
}

async function createVoice(model, user, text, format, report) {
  if (!token) return null;
  let voice = await resolveVoice(user);
  if (!voice) return null;
  let body = new FormData();
  body.append('text', text, { contentType: 'string' });
  body.append('voice_id', voice.id, { contentType: 'string' });
  let response_clone = await HTTP('POST', body.getHeaders(), '/tts/clone', body); //TODO this respons with 500
  await report(model, await getVoiceCost(text));
  return media.convert(pipeAudio(url.parse(response_clone.url)), null, format); //TODO what format do they respond with?
}

async function resolveVoice(user) {
  let voices = await HTTP('GET', {}, '/voice');
  return voices.find(voice => voice.name == 'Jenna Test');
  return voices.find(voice => voice.name == user);
}

async function pipeAudio(url) {
  return curl.request({ hostname: url.hostname, path: url.pathname + (url.search ?? ''), stream: true });
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
  headers['x-api-key'] = token; // https://webhook.site/09725061-5fc6-4648-b408-cd023c4c565f
  if (body) {
    headers['content-length'] = body.getLengthSync();
  }
  let result = await curl.request({
    // hostname: 'webhook.site',
    // path: '/09725061-5fc6-4648-b408-cd023c4c565f',
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
  seedVoice,
  createVoice
}
