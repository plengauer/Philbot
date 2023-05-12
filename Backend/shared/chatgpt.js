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

const DEFAULT_MODEL = "gpt-4";
const BACKUP_MODEL = "gpt-3.5-turbo";

async function getSingleResponse(message, model = undefined) {
  return getResponse(null, null, message, model);
}

async function getResponse(history_token, system, message, model = undefined) {
  // https://platform.openai.com/docs/guides/chat/introduction
  if (!process.env.OPENAI_API_KEY) return null;
  if (!model) model = DEFAULT_MODEL;
  if ((await getCurrentCost()).value >= cost_limit * 1.0) return null;
  if ((await getCurrentCost()).value >= cost_limit * 0.9) model = BACKUP_MODEL;

  const conversation_key = history_token ? `chatgpt:history:${history_token}` : null;
  let conversation = conversation_key ? await memory.get(conversation_key, []) : [];

  let input = { role: 'user', content: message.trim() };
  conversation.push(input);
  let response = await curl.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      headers: { 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
      method: 'POST',
      body: {
        "model": model,
        "messages": [{ "role": "system", "content": (system ?? '').trim() }].concat(conversation.slice(-(2 * 2 + 1)))
      },
      timeout: 1000 * 60 * 15
    });
  let output = response.choices[0].message;
  
  output.content = sanitizeResponse(output.content);

  conversation.push(output);
  if (conversation_key) await memory.set(conversation_key, conversation, 60 * 60 * 24 * 7);

  let cost = computeCost(response.model.replace(/-\d\d\d\d$/, ''), response.usage.prompt_tokens, response.usage.completion_tokens);

  let total_cost = await getCurrentCost();
  total_cost.value += cost;
  total_cost.timestamp = Date.now();
  await memory.set(costkey(), total_cost);

  const attributes = { model: response.model };
  cost_counter.add(cost, attributes);
  cost_absolute_counter.record(total_cost.value, attributes);
  cost_relative_counter.record(total_cost.value / cost_limit, attributes);
  cost_progress_counter.record(total_cost.value / (cost_limit * computeBillingSlotProgress()), attributes);

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
  response = strip(response, 'as a bot');
  response = strip(response, 'based on your previous message');
  response = strip(response, 'based on the information available in previous messages');
  response = strip(response, 'based on the information you provided earlier');
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

async function getCurrentCost() {
  let backup = { value: 0, timestamp: Date.now() };
  let cost = await memory.get(costkey(), backup);
  return (new Date(cost.timestamp).getUTCFullYear() == new Date().getUTCFullYear() && new Date(cost.timestamp).getUTCMonth() == new Date().getUTCMonth()) ? cost : backup;
}

function costkey() {
  return 'openai:cost';
}

function computeCost(model, tokens_prompt, tokens_completion) {
  switch (model) {
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

module.exports = { getSingleResponse, getResponse, canGetResponse }
