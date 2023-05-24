const process = require('process');
const memory = require('./memory.js');
const curl = require('./curl.js');
const synchronized = require('./synchronized.js');
const opentelemetry = require('@opentelemetry/api');

const token = process.env.OPENAI_API_KEY;
const cost_limit = parseFloat(process.env.OPENAI_API_COST_LIMIT ?? '1.00');
const debug = process.env.OPENAI_DEBUG == 'true'

const meter = opentelemetry.metrics.getMeter('openai');
meter.createObservableGauge('openai.cost.slotted.absolute').addCallback(async (result) => getCurrentCost().then(cost => result.observe(cost)));
meter.createObservableGauge('openai.cost.slotted.relative').addCallback(async (result) => getCurrentCost().then(cost => result.observe(cost / cost_limit)));
meter.createObservableGauge('openai.cost.slotted.progress').addCallback(async (result) => getCurrentCost().then(cost => result.observe((cost / cost_limit) / computeBillingSlotProgress())));
const request_counter = meter.createCounter('openai.requests');
const cost_counter = meter.createCounter('openai.cost');

const LANGUAGE_COMPLETION_MODELS = ["text-ada-001", "text-babbage-001", "text-curie-001", "text-davinci-001", "text-davinci-002", "text-davinci-003"];
const LANGUAGE_CHAT_MODELS = ["gpt-3.5-turbo", "gpt-4"];
const LANGUAGE_MODEL_MAPPING = { "ada": "text-ada-001", "babbage": "text-babbage-001", "curie": "text-curie-001", "davinci": "text-davinci-001", "gpt-1" : "text-davinci-001", "gpt-2" : "text-davinci-002", "gpt-3": "text-davinci-003", "gpt-3.5": "gpt-3.5-turbo" };

function getLanguageModels() {
  return LANGUAGE_COMPLETION_MODELS.concat(LANGUAGE_CHAT_MODELS);
}

function compareLanguageModelByCost(cheap_model, expensive_model) {
  return computeLanguageCost(cheap_model, 1, 1) < computeLanguageCost(expensive_model, 1, 1);
}

function compareLanguageModelByPower(bad_model, good_model) {
  let models = getLanguageModels();
  return models.indexOf(bad_model) < models.indexOf(good_model);
}

async function createCompletion(prompt, model = undefined, temperature = undefined) {
  model = model ?? getLanguageModels().slice(-1);
  model = LANGUAGE_MODEL_MAPPING[model] ?? model;
  if (!token) return null;
  if (!await canCreate()) return null;
  
  if (LANGUAGE_CHAT_MODELS.includes(model)) {
    return createResponse(null, null, `Complete the following text, respond with the completion only:\n${prompt}`, model, temperature);
  }
  
  let response = await HTTP('/v1/completions' , { "model": model, "prompt": prompt, temperature: temperature });
  let completion = response.choices[0].text.trim();
  await bill(computeLanguageCost(response.model, response.usage.prompt_tokens, response.usage.completion_tokens), response.model);
  return completion;
}

async function createResponse(history_token, system, message, model = undefined, temperature = undefined) {
  if (history_token) return synchronized.locked(`chatgpt:${history_token}`, () => createResponse0(history_token, system, message, model, temperature));
  else return createResponse0(history_token, system, message, model, temperature);
}

async function createResponse0(history_token, system, message, model = undefined, temperature = undefined) {
  // https://platform.openai.com/docs/guides/chat/introduction
  model = model ?? getLanguageModels().slice(-1);
  model = LANGUAGE_MODEL_MAPPING[model] ?? model;
  if (!token) return null;
  if (!await canCreate()) return null;

  const horizon = 2;
  const conversation_key = history_token ? `chatgpt:history:${history_token}` : null;
  let conversation = (conversation_key ? await memory.get(conversation_key, []) : []).slice(-(2 * horizon + 1));
  let input = { role: 'user', content: message.trim() };
  conversation.push(input);
  
  let output = null;
  if (LANGUAGE_COMPLETION_MODELS.includes(model)) {
    let completion = await createCompletion(`Complete the conversation.` + (system ? `\nassistant: "${system}"` : '') + '\n' + conversation.map(line => `${line.role}: "${line.content}"`).join('\n') + '\nassistant: ', model, temperature);
    if (completion.startsWith('"') && completion.endsWith('"')) completion = completion.substring(1, completion.length - 1);
    output = { role: 'assistant', content: completion.trim() };
  } else {
    let response = await HTTP('/v1/chat/completions' , { "model": model, "messages": [{ "role": "system", "content": (system ?? '').trim() }].concat(conversation), temperature: temperature });
    output = response.choices[0].message;
    await bill(computeLanguageCost(response.model.replace(/-\d\d\d\d$/, ''), response.usage.prompt_tokens, response.usage.completion_tokens), response.model);
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
    case "ada":
    case "text-ada-001":
      return (tokens_prompt + tokens_completion) / 1000 * 0.0004;
    case "babbage":
    case "text-babbage-001":
      return (tokens_prompt + tokens_completion) / 1000 * 0.0005;
    case "curie":
    case "text-curie-001":
      return (tokens_prompt + tokens_completion) / 1000 * 0.002;
    case "davinci":
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

async function createBoolean(question, model = undefined, temperature = undefined) {
  model = model ?? getLanguageModels().slice(-1);
  model = LANGUAGE_MODEL_MAPPING[model] ?? model;
  let response = null;
  if (LANGUAGE_COMPLETION_MODELS.includes(model)) {
    response = await createCompletion(`Respond to the question only with yes or no.\nQuestion: ${question}\nResponse:`, model, temperature);
  } else {
    response = await createResponse(null, null, `${question} Respond only with yes or no!`, model, temperature);
  }
  if (!response) return null;
  let boolean = response.trim().toLowerCase();
  const match = boolean.match(/^([a-z]+)/);
  boolean = match ? match[0] : boolean;
  if (boolean != 'yes' && boolean != 'no') {
    let sentiment = await createCompletion(`Determine whether the sentiment of the text is positive or negative.\nText: "${response}"\nSentiment: `, model, temperature);
    const sentiment_match = sentiment.trim().toLowerCase().match(/^([a-z]+)/);
    if (sentiment_match && sentiment_match[0] == 'positive') boolean = 'yes';
    else if (sentiment_match && sentiment_match[0] == 'negative') boolean = 'no';
    else throw new Error('Response is not a bool! (' + response + ') and sentiment analysis couldn\'t recover it (' + sentiment + ')!');
  }
  return boolean == 'yes';
}

const IMAGE_SIZES = ["256x256", "512x512", "1024x1024"];

function getImageSizes() {
  return IMAGE_SIZES;
}

async function createImage(message, size = undefined) {
  if (!size) size = IMAGE_SIZES[IMAGE_SIZES.length - 1];
  if (!token) return null;
  if (!await canCreate()) return null;
  try {
    let response = await HTTP('/v1/images/generations', { prompt: message, response_format: 'b64_json', size: size });
    let image = Buffer.from(response.data[0].b64_json, 'base64');
    await bill(getImageCost(size), 'dall-e 2');
    return image;
  } catch (error) {
    throw new Error(JSON.parse(error.message.split(':').slice(1).join(':')).error.message);
  }
}

function getImageCost(size) {
  switch(size) {
    case   "256x256": return 0.016;
    case   "512x512": return 0.018;
    case "1024x1024": return 0.020;
  }
}

async function HTTP(endpoint, body) {
  let result = await curl.request({
    hostname: 'api.openai.com',
    path: endpoint,
    headers: { 'Authorization': 'Bearer ' + token },
    method: 'POST',
    body: body,
    timeout: 1000 * 60 * 15
  });
  if (debug) console.log('DEBUG OPENAI ' + JSON.stringify(body) + ' => ' + (endpoint == '/v1/images/generations' ? '###' : JSON.stringify(result)));
  return result;
}

async function bill(cost, model) {
  const attributes = { 'openai.model': model };
  request_counter.add(1, attributes);
  cost_counter.add(cost, attributes);
  return synchronized.locked('openai.billing', () => getCurrentCost()
    .then(current_cost => memory.set(costkey(), { value: current_cost + cost, timestamp: Date.now() }, 60 * 60 * 24 * 31))
  );
}

async function getCurrentCost() {
  let backup = { value: 0, timestamp: Date.now() };
  let cost = await memory.get(costkey(), backup);
  if (!(new Date(cost.timestamp).getUTCFullYear() == new Date().getUTCFullYear() && new Date(cost.timestamp).getUTCMonth() == new Date().getUTCMonth())) cost = backup;
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

module.exports = { getLanguageModels, compareLanguageModelByCost, compareLanguageModelByPower, createCompletion, createResponse, createBoolean, getImageSizes, createImage, canCreate, shouldCreate, getDynamicModel, getDefaultDynamicModelSafety  }
