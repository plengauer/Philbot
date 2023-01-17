const memory = require('../../../shared/memory.js');
const discord = require('../../../shared/discord.js');
const player = require('../../../shared/player.js');

async function handle(payload) {
  return discord.me()
    .then(me => memory.get(`voice_channel:user:${me.id}`))
    .then(voice_status => voice_status?.channel_id ? player.playNext(payload.guild_id, payload.user_id) : player.stop(payload.guild_id))
}

module.exports = { handle }
