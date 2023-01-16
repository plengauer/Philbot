const player = require('../../../shared/player.js');
const discord = require('../../../shared/discord.js');

async function handle(payload) {
  return discord.me()
    .then(me => memory.get(`voice_channel:user:${me.id}`))
    .then(voice_status => voice_status?.channel_id ? player.playNext(payload.guild_id, payload.user_id) : player.stop())
}

module.exports = { handle }
