const features = require('../../../shared/features.js');
const role_management = require('../../../shared/role_management.js');

async function handle(payload) {
  return features.isActive(payload.guild_id, "role management")
    .then(active ? role_management.on_reaction_add(payload.guild_id, payload.channel_id, payload.message_id, payload.user_id, payload.emoji.name) : Promise.resolve())
    .then(() => undefined);
}

module.exports = { handle }
  
