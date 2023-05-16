const discord = require('../../../shared/discord.js');
const player = require('../../../shared/player.js');
const memory = require('../../../shared/memory.js');
const chatgpt = require('../../../shared/openai.js');

async function handle(payload) {
  if (payload.data.custom_id == 'interaction.debug.ping' || payload.data.custom_id == 'interaction.noop') return discord.interact(payload.id, payload.token);
  else if (payload.data.custom_id.startsWith('player.')) return player.onInteraction(payload.guild_id, payload.channel_id, payload.message.id, payload.id, payload.token, payload.data).then(() => undefined);
  else if (payload.data.custom_id.startsWith('openai.')) return onOpenAIInteraction(payload.guild_id, payload.channel_id, payload.message.id, payload.id, payload.token, payload.data).then(() => undefined);
  else throw new Error('Unknown interaction: ' + payload.data.custom_id);
}

async function onOpenAIInteraction(guild_id, channel_id, message_id, interaction_id, interaction_token, interaction_data) {
  switch(data.custom_id) {
    case 'openai.modal': return discord.interact(interaction_id, interaction_token, {
      type: 9,
      data: {
        "title": "OpenAI",
        "custom_id": "openai.request",
        "components": [{
          "type": 1,
          "components": [
            {
              "type": 3,
              "custom_id": "openai.model",
              "placeholder": "Choose a model",
              "min_values": 1,
              "max_values": 1,
              "options": chatgpt.getLanguageModels().map(model => { return { label: model, value: model }; })
            },{
              "type": 4,
              "custom_id": "openai.prompt",
              "label": "Prompt",
              "style": 1,
              "min_length": 5,
              "max_length": 4000,
              "placeholder": "Tell me the answer to universe, life, and everything.",
              "required": true
            }
          ]
        }]
      }
    });
    case 'openai.request':
      let model = data.components[0].components.find(component.custom_id == 'openai.model').value;
      let prompt = data.components[0].components.find(component.custom_id == 'openai.prompt').value;
      return discord.interact(interaction_id, interaction_token)
        .then(() => chatgpt.getSingleResponse(prompt, model))
        .then(response => discord.post(channel_id, `**OpenAI**\nPrompt: ${prompt}\nModel: ${model}\nResponse: ${response}`));
    default: throw new Error('Unknown interaction: ' + data.custom_id);
  }
}

module.exports = { handle }
