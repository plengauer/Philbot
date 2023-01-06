const player = require('../../../shared/player.js');

async function handle(payload) {
  return player.on_voice_server_update(payload.guild_id, 'wss://' + payload.endpoint, payload.token).then(() => undefined);
}

module.exports = { handle }
