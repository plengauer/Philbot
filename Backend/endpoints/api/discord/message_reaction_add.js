const role_management = require('../../../shared/role_management.js');

async function handle(payload) {
  return role_management.on_reaction_add(payload.guild_id, payload.channel_id, payload.message_id, payload.user_id, payload.emoji)
    .then(() => undefined);
}

module.exports = { handle }
  
