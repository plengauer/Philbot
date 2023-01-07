const features = require('../../../shared/features.js');
const role_management = require('../../../shared/role_management.js');

async function handle(payload) {
  return features.isActive(payload.guild_id, "role management")
    .then(active => active ? role_management.on_guild_member_roles_update(payload.guild_id, payload.user.id, payload.roles) : Promise.resolve())
    .then(() => undefined);
}

module.exports = { handle }
  
