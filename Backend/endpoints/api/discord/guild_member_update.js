const features = require('../../../shared/features.js');
const role_management = require('../../../shared/role_management.js');
const sticky_nicknames = require('../../../shared/sticky_nicknames.js');

async function handle(payload) {
  return Promise.all([
      features.isActive(payload.guild_id, "role management").then(active => active ? role_management.on_guild_member_roles_update(payload.guild_id, payload.user.id) : Promise.resolve()),
      features.isActive(payload.guild_id, "sticky nicknames").then(active => active ? sticky_nicknames.on_guild_member_update(payload.guild_id, payload.user.id) : Promise.resolve())
    ]).then(() => undefined);
}

module.exports = { handle }
  
