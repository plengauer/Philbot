const process = require('process');
const memory = require('./memory.js');
const curl = require('./curl.js');

async function getResponse(channel_id, user_id, message) {
  // https://platform.openai.com/docs/guides/chat/introduction
  if (!process.env.OPENAI_API_KEY) return null;
  const conversation_key = `conversation:channel:${channel_id}:user:${user_id}`;
  let conversation = await memory.get(conversation_key, []);
  conversation.push({ role: 'user', content: message });
  let response = await curl.request({
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    headers: { 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
    method: 'POST',
    body: {
      "model": "gpt-3.5-turbo",
      "messages": [{ "role": "system", "content": "You are a Discord bot. You are depressed." }].concat(conversation.slice(-6))
    }
  }).then(result => result.choices[0].message);
  conversation.push(response);
  await memory.set(conversation_key, conversation, 60 * 60 * 24 * 7);
  return response.content;
}

module.exports = { getResponse }
