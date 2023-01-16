const player = require('../../../shared/player.js');
const discord = require('../../../shared/discord.js');

(await memory.get(`voice_channel:user:${user_id}`, null))?.channel_id

async function handle(payload) {
  return discord.me()
    .then(me => memory.get(`voice_channel:user:${me.id}`))
    .then(voice_status => voice_status?.channel_id ? player.playNext(payload.guild_id, payload.user_id) : undefined)
}

module.exports = { handle }
