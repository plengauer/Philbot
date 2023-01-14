const player = require('../../../shared/player.js');

async function handle(payload) {
  return player.playNext(payload.guild_id, payload.user_id).then(reply => reply && reply.command ? { status: 200, body: reply } : undefined);
}

module.exports = { handle }
