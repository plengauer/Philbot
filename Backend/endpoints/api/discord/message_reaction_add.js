const discord = require('../../../shared/discord.js');
const features = require('../../../shared/features.js');
const role_management = require('../../../shared/role_management.js');
const mirror = require('../../../shared/mirror.js');

async function handle(payload) {
  return Promise.all([
    mirror.on_reaction_add(payload.guild_id, payload.channel_id, payload.user_id, payload.message_id, payload.emoji),
    features.isActive(payload.guild_id, "role management").then(active => active ? role_management.on_reaction_add(payload.guild_id, payload.user_id) : Promise.resolve())
  ]).then(() => undefined);
}

module.exports = { handle }
  
