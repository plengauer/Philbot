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

const system = "My name is Philbot. I am a Discord bot. I am depressed.";

async function getResponse(channel_id, user_id, message, model = "gpt-4") {
  // https://platform.openai.com/docs/guides/chat/introduction
  if (!process.env.OPENAI_API_KEY) return null;
  if ((await getCurrentCost()).value >= cost_limit * 1.0) return null;
  if ((await getCurrentCost()).value >= cost_limit * 0.9) model = "gpt-3.5-turbo";

  const conversation_key = (channel_id && user_id) ? `conversation:channel:${channel_id}:user:${user_id}` : null;
  let conversation = conversation_key ? await memory.get(conversation_key, []) : [];

  let input = { role: 'user', content: message };
  conversation.push(input);
  let response = await curl.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      headers: { 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
      method: 'POST',
      body: {
        "model": model,
        "messages": [{ "role": "system", "content": conversation ? system : '' }].concat(conversation.slice(-2 * 2))
      },
      timeout: 1000 * 60 * 15
    });
  let output = response.choices[0].message;

  conversation.push(output);
  if (conversation_key) await memory.set(conversation_key, conversation, 60 * 60 * 24 * 7);

  let cost = await getCurrentCost()
  cost.value += computeCost(response.model.replace(/-\d\d\d\d$/, ''), response.usage.prompt_tokens, response.usage.completion_tokens);
  cost.timestamp = Date.now();
  await memory.set(costkey(), cost);

  const attributes = { model: response.model };
  cost_counter.add(cost, attributes);
  cost_absolute_counter.record(cost.value, attributes);
  cost_relative_counter.record(cost.value / cost_limit, attributes);
  cost_progress_counter.record(cost.value / (cost_limit * computeBillingSlotProgress()), attributes);

  return output.content;
}

async function getCurrentCost() {
  let backup = { value: 0, timestamp: Date.now() };
  let cost = await memory.get(costkey(), backup);
  return new Date(cost.timestamp).getUTCMonth() != new Date().getUTCMonth() ? backup : cost;
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

module.exports = { getResponse, canGetResponse }
