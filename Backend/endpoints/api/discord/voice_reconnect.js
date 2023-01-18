const discord = require('../../../shared/discord.js');

async function handle(payload) {
  return discord.disconnect(payload.guild_id).then(() => discord.connect(payload.guild_id, payload.channel_id));
}

module.exports = { handle }
