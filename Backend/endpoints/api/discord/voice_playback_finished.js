const player = require('../../../shared/player.js');

async function handle(payload) {
  return player.playNext(payload.guild_id, undefined, true).then(() => undefined);
}

module.exports = { handle }
