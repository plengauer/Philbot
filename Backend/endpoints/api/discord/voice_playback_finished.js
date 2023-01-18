const memory = require('../../../shared/memory.js');
const discord = require('../../../shared/discord.js');
const player = require('../../../shared/player.js');

async function handle(payload) {
  return player.playNext(payload.guild_id, payload.user_id);
}

module.exports = { handle }
