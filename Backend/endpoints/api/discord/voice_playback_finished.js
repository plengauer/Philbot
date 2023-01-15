const player = require('../../../shared/player.js');

async function handle(payload) {
  return player.playNext(payload.guild_id, payload.user_id)
    .then(() => undefined);
}

module.exports = { handle }
