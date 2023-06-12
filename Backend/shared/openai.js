const process = require('process');
const child_process = require('child_process');
const url = require('url');
const memory = require('./memory.js');
const curl = require('./curl.js');
const synchronized = require('./synchronized.js');
const opentelemetry = require('@opentelemetry/api');
let FormData = require('form-data');

const token = process.env.OPENAI_API_KEY;
const cost_limit = parseFloat(process.env.OPENAI_API_COST_LIMIT ?? '1.00');
const debug = process.env.OPENAI_DEBUG == 'true'

const meter = opentelemetry.metrics.getMeter('openai');
meter.createObservableGauge('openai.cost.slotted.absolute').addCallback(async (result) => getCurrentCost().then(cost => result.observe(cost)));
meter.createObservableGauge('openai.cost.slotted.relative').addCallback(async (result) => getCurrentCost().then(cost => result.observe(cost / cost_limit)));
meter.createObservableGauge('openai.cost.slotted.progress').addCallback(async (result) => getCurrentCost().then(cost => result.observe((cost / cost_limit) / computeBillingSlotProgress())));
const request_counter = meter.createCounter('openai.requests');
const cost_counter = meter.createCounter('openai.cost');

function compareLanguageModelByCost(cheap_model, expensive_model) {
  return computeLanguageCost(cheap_model, 1, 1) < computeLanguageCost(expensive_model, 1, 1);
}

function compareLanguageModelByPower(bad_model, good_model) {
  return getModelPower(bad_model) < getModelPower(good_model);
}

async function getLanguageModels() {
  let models = await getModels();
  models = models.filter(model => model.match(/text-[a-zA-Z]+(:|-)\d\d\d$/) || (model.match(/gpt-*/) && !model.match(/-\d{4}$/)));
  models = Array.from(new Set(models));
  models = models.sort((m1, m2) => {
    let p1 = getModelPower(m1);
    let p2 = getModelPower(m2);
    return (p1 != p2) ? p1 - p2 : m1.localeCompare(m2);
  });
  return models;
}

async function createCompletion(user, prompt, model = undefined, temperature = undefined) {
  model = model ?? (await getLanguageModels()).slice(-1);
  if (!token) return null;
  if (!await canCreate()) return null;
  
  if (!model.startsWith('text-')) {
    return createResponse(user, null, null, `Complete the following text, respond with the completion only:\n${prompt}`, model, temperature);
  }
  
  let response = await HTTP('/v1/completions' , { user: user, "model": model, "prompt": prompt, temperature: temperature });
  let completion = response.choices[0].text.trim();
  await bill(computeLanguageCost(response.model, response.usage.prompt_tokens, response.usage.completion_tokens), response.model, user);
  return completion;
}

async function createResponse(user, history_token, system, message, model = undefined, temperature = undefined) {
  if (history_token) return synchronized.locked(`chatgpt:${history_token}`, () => createResponse0(user, history_token, system, message, model, temperature));
  else return createResponse0(user, history_token, system, message, model, temperature);
}

async function createResponse0(user, history_token, system, message, model = undefined, temperature = undefined) {
  // https://platform.openai.com/docs/guides/chat/introduction
  model = model ?? (await getLanguageModels()).slice(-1);
  if (!token) return null;
  if (!await canCreate()) return null;

  const horizon = 2;
  const conversation_key = history_token ? `chatgpt:history:${history_token}` : null;
  let conversation = (conversation_key ? await memory.get(conversation_key, []) : []).slice(-(2 * horizon + 1));
  let input = { role: 'user', content: message.trim() };
  conversation.push(input);
  
  let output = null;
  if (!model.startsWith('gpt-')) {
    let completion = await createCompletion(user, `Complete the conversation.` + (system ? `\nassistant: "${system}"` : '') + '\n' + conversation.map(line => `${line.role}: "${line.content}"`).join('\n') + '\nassistant: ', model, temperature);
    if (completion.startsWith('"') && completion.endsWith('"')) completion = completion.substring(1, completion.length - 1);
    output = { role: 'assistant', content: completion.trim() };
  } else {
    let response = await HTTP('/v1/chat/completions' , { user: user, "model": model, "messages": [{ "role": "system", "content": (system ?? '').trim() }].concat(conversation), temperature: temperature });
    output = response.choices[0].message;
    await bill(computeLanguageCost(response.model.replace(/-\d\d\d\d$/, ''), response.usage.prompt_tokens, response.usage.completion_tokens), response.model, user);
  }
  output.content = sanitizeResponse(output.content);

  conversation.push(output);
  if (conversation_key) await memory.set(conversation_key, conversation, 60 * 60 * 24 * 7);

  return output.content;
}

function sanitizeResponse(response) {
  response = strip(response, 'as an AI');
  response = strip(response, 'as an AI model');
  response = strip(response, 'as an AI language model');
  response = strip(response, 'as a language model AI');
  response = strip(response, 'as a responsible AI');
  response = strip(response, 'as a responsible AI model');
  response = strip(response, 'as a responsible AI language model');
  response = strip(response, 'as a responsible language model AI');
  response = strip(response, 'based on your previous message');
  response = strip(response, 'based on what you\'ve shared earlier');
  response = strip(response, 'based on the information available in previous messages');
  response = strip(response, 'based on the information you provided earlier');
  response = strip(response, 'based on information available in previous messages');
  response = strip(response, 'based on information you provided earlier');
  return response.trim();
}

function strip(haystack, needle) {
  {
    let myneedle = needle.substring(0, 1).toUpperCase() + needle.substring(1) + ', ';
    while (haystack.includes(myneedle)) {
      let index = haystack.indexOf(myneedle);
      haystack = haystack.substring(0, index) + haystack.substring(index + myneedle.length, index + myneedle.length + 1).toUpperCase() + haystack.substring(index + myneedle.length + 1);
    }
  }
  {
    let myneedle = ', ' + needle + ', ';
    while (haystack.includes(myneedle)) {
      let index = haystack.indexOf(myneedle);
      haystack = haystack.substring(0, index) + ', ' + haystack.substring(index + myneedle.length);
    }
  }
  {
    let myneedle = ', but ' + needle + ', ';
    while (haystack.includes(myneedle)) {
      let index = haystack.indexOf(myneedle);
      haystack = haystack.substring(0, index) + ', ' + haystack.substring(index + myneedle.length);
    }
  }
  return haystack;
}

function computeLanguageCost(model, tokens_prompt, tokens_completion) {
  switch (model) {
    case "text-ada-001":
      return (tokens_prompt + tokens_completion) / 1000 * 0.0004;
    case "text-babbage-001":
      return (tokens_prompt + tokens_completion) / 1000 * 0.0005;
    case "text-curie-001":
      return (tokens_prompt + tokens_completion) / 1000 * 0.002;
    case "text-davinci-001":
    case "text-davinci-002":
    case "text-davinci-003":
      return (tokens_prompt + tokens_completion) / 1000 * 0.02;
    case "gpt-3.5-turbo":
      return (tokens_prompt + tokens_completion) / 1000 * 0.002;
    case "gpt-4":
      return tokens_prompt / 1000 * 0.03 + tokens_completion / 1000 * 0.06;
    case "gpt-4-32k":
      return tokens_prompt / 1000 * 0.06 + tokens_completion / 1000 * 0.12;
    default:
      throw new Error("Unknown model: " + model);
  }
}

async function createBoolean(user, question, model = undefined, temperature = undefined) {
  model = model ?? (await getLanguageModels()).slice(-1);
  let response = null;
  if (model.startsWith('text-')) {
    response = await createCompletion(user, `Respond to the question only with yes or no.\nQuestion: ${question}\nResponse:`, model, temperature);
  } else {
    response = await createResponse(user, null, null, `${question} Respond only with yes or no!`, model, temperature);
  }
  if (!response) return null;
  let boolean = response.trim().toLowerCase();
  const match = boolean.match(/^([a-z]+)/);
  boolean = match ? match[0] : boolean;
  if (boolean != 'yes' && boolean != 'no') {
    let sentiment = await createCompletion(user, `Determine whether the sentiment of the text is positive or negative.\nText: "${response}"\nSentiment: `, model, temperature);
    const sentiment_match = sentiment.trim().toLowerCase().match(/^([a-z]+)/);
    if (sentiment_match && sentiment_match[0] == 'positive') boolean = 'yes';
    else if (sentiment_match && sentiment_match[0] == 'negative') boolean = 'no';
    else throw new Error('Response is not a bool! (' + response + ') and sentiment analysis couldn\'t recover it (' + sentiment + ')!');
  }
  return boolean == 'yes';
}

const IMAGE_MODELS = [ 'dall-e 2' ];
const IMAGE_SIZES = ["256x256", "512x512", "1024x1024"];

async function getImageModels() {
  return IMAGE_MODELS;
}

function getImageSizes(model) {
  return IMAGE_SIZES;
}

async function createImage(user, prompt, model = undefined, size = undefined) {
  model = model ?? (await getImageModels()).slice(-1);
  if (!size) size = IMAGE_SIZES[IMAGE_SIZES.length - 1];
  if (!token) return null;
  if (!await canCreate()) return null;
  try {
    let estimated_size = size.split('x').reduce((d1, d2) => d1 * d2, 1) * 4;
    let pipe = estimated_size > 1024 * 1024;
    let response = await HTTP('/v1/images/generations', { user: user, prompt: prompt, response_format: pipe ? 'url' : 'b64_json', size: size });
    let result = response.data[0];
    let image = pipe ? await pipeImage(url.parse(result.url)) : Buffer.from(result.b64_json, 'base64');
    await bill(getImageCost(model, size), model, user);
    return image;
  } catch (error) {
    throw new Error(JSON.parse(error.message.split(':').slice(1).join(':')).error.message);
  }
}

async function pipeImage(url) {
  return curl.request({ hostname: url.hostname, path: url.pathname + (url.search ?? ''), stream: true });
}

function getImageCost(model, size) {
  switch(size) {
    case   "256x256": return 0.016;
    case   "512x512": return 0.018;
    case "1024x1024": return 0.020;
    default: throw new Error('Unknown size: ' + size);
  }
}

async function getTranscriptionModels() {
  return getModels().then(models => models.filter(model => model.startsWith('whisper-')));
}

async function createTranscription(user, audio_stream, audio_stream_format, audio_stream_length_millis, model = undefined) {
  model = model ?? (await getTranscriptionModels()).slice(-1);
  if (!token) return null;
  if (!await canCreate()) return null;
  if (!['mp3', 'mp4', 'wav', 'm4a', 'webm', 'mpga', 'wav', 'mpeg'].includes(audio_stream_format)) {
    audio_stream_format = 'mp3';
    const convertion = child_process.spawn("ffmpeg", ["-i", "pipe:0", "-f", audio_stream_format, "pipe:1"]);
    audio_stream.pipe(convertion.stdin);
    audio_stream = convertion.stdout;
  }
  let body = new FormData();
  body.append('model', model, { contentType: 'string' });
  body.append('file', audio_stream, { contentType: 'audio/' + audio_stream_format, filename: 'audio.' + audio_stream_format });
  let response = await HTTP('/v1/audio/transcriptions', body, body.getHeaders());
  response.text = sanitizeTranscription(model, response.text);
  await bill(getTranscriptionCost(model, audio_stream_length_millis), model, user);
  return response.text;
}

function sanitizeTranscription(model, input) {
  if (model == 'whisper-1' && input == 'Thank you.') return ''; // breathing is too often mistaken as "Thank you."
  if (model == 'whisper-1' && input == 'you') return ''; // random throat clearings are represented as "you"
  return input;
}

function getTranscriptionCost(model, time_millis) {
  switch (model) {
    case "whisper-1": return Math.round(time_millis / 1000) / 60 * 0.006;
    default: throw new Error('Unknown model: ' + model);
  }
}

async function HTTP(endpoint, body, headers = {}) {
  headers['Authorization'] = 'Bearer ' + token;
  let result = await curl.request({
    hostname: 'api.openai.com',
    path: endpoint,
    headers: headers,
    method: 'POST',
    body: body,
    timeout: 1000 * 60 * 15
  });
  if (debug) console.log('DEBUG OPENAI ' + (endpoint == '/v1/audio/transcriptions' ? '<audio>' :  JSON.stringify(body)) + ' => ' + (endpoint == '/v1/images/generations' && body.response_format == 'b64_json' ? '###' : JSON.stringify(result)));
  return result;
}

async function bill(cost, model, user) {
  const attributes = { 'openai.model': model, 'openai.user': user };
  request_counter.add(1, attributes);
  cost_counter.add(cost, attributes);
  return synchronized.locked('openai.billing', () => {
    let now = Date.now(); // we need to get the time first because we may be just at the limit of a billing slot (this way we may lose a single entry worst case, but we wont carry over all the cost to the next)
    return getCurrentCost(now).then(current_cost => memory.set(costkey(), { value: current_cost + cost, timestamp: now }, 60 * 60 * 24 * 31));
  });
  
}

async function getCurrentCost() {
  let now = new Date();
  let backup = { value: 0, timestamp: now };
  let cost = await memory.get(costkey(), backup);
  if (!(new Date(cost.timestamp).getUTCFullYear() == now.getUTCFullYear() && new Date(cost.timestamp).getUTCMonth() == now.getUTCMonth())) cost = backup;
  return cost.value;
}

function costkey() {
  return 'openai:cost';
}

async function canCreate() {
  return (await computeCostProgress()) < 1;
}

async function shouldCreate(threshold = 0.8) {
  return (await computeCostProgress()) / computeBillingSlotProgress() < threshold;
}

async function computeCostProgress() {
   return (await getCurrentCost()) / cost_limit;
}

function computeBillingSlotProgress() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const totalDaysInMonth = endOfMonth.getDate() - startOfMonth.getDate() + 1;
  const millisSinceStartOfMonth = now.getTime() - startOfMonth.getTime();
  return millisSinceStartOfMonth / (totalDaysInMonth * 1000 * 60 * 60 * 24);
}

async function getModels() {
  return curl.request({ method: 'GET', hostname: 'api.openai.com', path: '/v1/models', headers: { 'Authorization': 'Bearer ' + token }, cache: 60 * 60 * 24 })
    .then(result => result.data.map(model => model.id.replace(/:/, '-')))
    .then(models => Array.from(new Set(models)));
}

function getModelPower(model) {
  return parseFloat(model.match(/\d+(\.\d+)?/g).join(''));
}

const DEFAULT_DYNAMIC_MODEL_SAFETY = 0.5;

function getDefaultDynamicModelSafety() {
  return DEFAULT_DYNAMIC_MODEL_SAFETY;
}

async function getDynamicModel(models, safety = DEFAULT_DYNAMIC_MODEL_SAFETY) {
  let model_index = models.length - 1;
  let threshold = safety;
  while (!await shouldCreate(1 - threshold) && model_index > 0) {
    model_index--;
    threshold = threshold * safety;
  }
  return process.env.OPENAI_DYNAMIC_MODEL_OVERRIDE ?? models[model_index];
}

module.exports = { getLanguageModels, compareLanguageModelByCost, compareLanguageModelByPower, createCompletion, createResponse, createBoolean, getImageModels, getImageSizes, createImage, getTranscriptionModels, createTranscription, canCreate, shouldCreate, getDynamicModel, getDefaultDynamicModelSafety  }
