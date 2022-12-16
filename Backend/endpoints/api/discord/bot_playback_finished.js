const player = require('../../../shared/player.js');

////// UNDER CONSTRUCTION (this will currently be never called)

async function handle(payload) {
  return Math.random() < 0.99 ? player.playNext(payload.guild_id, null) : player.play(payload.guild_id, null, null, 'rick roll')
    .then(() => undefined);
}

module.exports = { handle }