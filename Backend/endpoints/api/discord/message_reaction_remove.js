const features = require('../../../shared/features.js');
const role_management = require('../../../shared/role_management.js');

async function handle(payload) {
  return features.isActive(payload.guild_id, "role management")
    .then(active => active ? role_management.on_reaction_remove(payload.guild_id, payload.user_id) : Promise.resolve())
    .then(() => undefined);
}

module.exports = { handle }
  
