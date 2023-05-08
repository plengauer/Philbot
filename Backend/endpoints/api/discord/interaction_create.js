const discord = require('../../../shared/discord.js');
const curl = require('../../../shared/curl.js');
const player = require('../../../shared/player.js');

async function handle(payload) {
  let guild_id = payload.guild_id ?? await resolveGuildID(payload.member.user.id);
  if (payload.data.custom_id == 'interaction.debug.ping') return discord.interact(payload.id, payload.token);
  else if (payload.data.custom_id.startsWith('player.')) return player.onInteraction(guild_id, payload.channel_id, payload.id, payload.token, payload.data);
  else throw new Error('Unknown interaction: ' + payload.data.custom_id);
}

async function resolveGuildID(user_id) {
  return memory.get(`voice_channel:user:${user_id}`, null).then(info => info ? info.guild_id : null);
}

module.exports = { handle }
  
