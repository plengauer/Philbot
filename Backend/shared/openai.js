const process = require('process');
const memory = require('./memory.js');
const curl = require('./curl.js');
const opentelemetry = require('@opentelemetry/api');

const cost_limit = parseFloat(process.env.OPENAI_API_COST_LIMIT ?? '1.00');

const meter = opentelemetry.metrics.getMeter('openai');
const cost_counter = meter.createCounter('openai.cost');
const cost_absolute_counter = meter.createHistogram('openai.cost.slotted.absolute');
const cost_relative_counter = meter.createHistogram('openai.cost.slotted.relative');
const cost_progress_counter = meter.createHistogram('openai.cost.slotted.progress');

const LANGUAGE_MODELS = ["ada", "babbage", "curie", "davinci", "gpt-3.5-turbo", "gpt-4"];

function getLanguageModels() {
  return LANGUAGE_MODELS;
}

async function getSingleResponse(message, model = undefined) {
  return getResponse(null, null, message, model);
}

async function getResponse(history_token, system, message, model = undefined) {
  // https://platform.openai.com/docs/guides/chat/introduction
  if (!process.env.OPENAI_API_KEY) return null;
  if (!model) model = LANGUAGE_MODELS[LANGUAGE_MODELS.length - 1];
  if ((await getCurrentCost()).value >= cost_limit * 1.0) return null;

  const conversation_key = history_token ? `chatgpt:history:${history_token}` : null;
  let conversation = conversation_key ? await memory.get(conversation_key, []) : [];

  let input = { role: 'user', content: message.trim() };
  conversation.push(input);

  let output = null;
  let response = null;
  if (model.startsWith('gpt-')) {
    response = await HTTP('/v1/chat/completions' , {
      "model": model,
      "messages": [{ "role": "system", "content": (system ?? '').trim() }].concat(conversation.slice(-(2 * 2 + 1)))
    });
  } else {
    response = await HTTP('/v1/completions' , {
      "model": model,
      "prompt": input.content
    });
    for (let index = 0; index < response.choices.length; index++) {
      response.choices[index] = { message: { role: 'assistent', content: response.choices[index].text }};
    }
  }

  output = response.choices[0].message;
  output.content = sanitizeResponse(output.content);

  conversation.push(output);
  if (conversation_key) await memory.set(conversation_key, conversation, 60 * 60 * 24 * 7);

  let cost = computeTextCost(response.model.replace(/-\d\d\d\d$/, ''), response.usage.prompt_tokens, response.usage.completion_tokens);
  await bill(cost, response.model);

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
  return response;
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

function computeTextCost(model, tokens_prompt, tokens_completion) {
  switch (model) {
    case "ada":
      return (tokens_prompt + tokens_completion) / 1000 * 0.0004;
    case "babbage":
      return (tokens_prompt + tokens_completion) / 1000 * 0.0005;
    case "curie":
      return (tokens_prompt + tokens_completion) / 1000 * 0.002;
    case "davinci":
      return (tokens_prompt + tokens_completion) / 1000 * 0.02;
    case "gpt-3.5-turbo":
      return (tokens_prompt + tokens_completion) / 1000 * 0.002;
    case "gpt-4":
      return tokens_prompt / 1000 * 0.03 + tokens_completion / 1000 * 0.06;
    case "gpt-4-32k":
      return tokens_prompt / 1000 * 0.06 + tokens_completion / 1000 * 0.12;
    default:
      throw new Error();
  }
}

const IMAGE_SIZES = ["256x256", "512x512", "1024x1024"];

async function getImageSizes() {
  return IMAGE_SIZES;
}

async function getImageResponse(message, size = undefined) {
  if (!process.env.OPENAI_API_KEY) return null;
  if ((await getCurrentCost()).value >= cost_limit * 1.0) return null;
  if (!size) size = IMAGE_SIZES[IMAGE_SIZES.length - 1];
  let url = await HTTP('/v1/images/generations', {
      prompt: message,
      size: size,
    })
    .then(response => response.data[0].url)
    .catch(error => JSON.parse(error.message.split(':').slice(1).join(':')).error.message);
  await bill(getImageCost(size), 'dall-e');
  return url;
}

function getImageCost(size) {
  switch(size) {
    case   "256x256": return 0.016;
    case   "512x512": return 0.018;
    case "1024x1024": return 0.020;
  }
}

async function HTTP(endpoint, body) {
  return await curl.request({
    hostname: 'api.openai.com',
    path: endpoint,
    headers: { 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
    method: 'POST',
    body: body,
    timeout: 1000 * 60 * 15
  });
}

async function bill(cost, model) {
  let total_cost = await getCurrentCost();
  total_cost.value += cost;
  total_cost.timestamp = Date.now();
  await memory.set(costkey(), total_cost);

  const attributes = { 'openai.model': model };
  cost_counter.add(cost, attributes);
  cost_absolute_counter.record(total_cost.value, attributes);
  cost_relative_counter.record(total_cost.value / cost_limit, attributes);
  cost_progress_counter.record(total_cost.value / (cost_limit * computeBillingSlotProgress()), attributes);
}

async function getCurrentCost() {
  let backup = { value: 0, timestamp: Date.now() };
  let cost = await memory.get(costkey(), backup);
  return (new Date(cost.timestamp).getUTCFullYear() == new Date().getUTCFullYear() && new Date(cost.timestamp).getUTCMonth() == new Date().getUTCMonth()) ? cost : backup;
}

function costkey() {
  return 'openai:cost';
}

async function canGetResponse(threshold = 0.8) {
  return (await getCurrentCost()).value / cost_limit * threshold < computeBillingSlotProgress();
}

function computeBillingSlotProgress() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const totalDaysInMonth = endOfMonth.getDate() - startOfMonth.getDate() + 1;
  const millisSinceStartOfMonth = now.getTime() - startOfMonth.getTime();
  return millisSinceStartOfMonth / (totalDaysInMonth * 1000 * 60 * 60 * 24);
}

module.exports = { getLanguageModels, getSingleResponse, getResponse, getImageSizes, getImageResponse, canGetResponse }
