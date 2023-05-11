const discord = require('../../../shared/discord.js');
const player = require('../../../shared/player.js');
const memory = require('../../../shared/memory.js');

async function handle(payload) {
  if (payload.data.custom_id == 'interaction.debug.ping' || payload.data.custom_id == 'interaction.noop') return discord.interact(payload.id, payload.token);
  else if (payload.data.custom_id.startsWith('player.')) return player.onInteraction(payload.guild_id, payload.channel_id, payload.message.id, payload.id, payload.token, payload.data).then(() => undefined);  
  else throw new Error('Unknown interaction: ' + payload.data.custom_id);
}

module.exports = { handle }
