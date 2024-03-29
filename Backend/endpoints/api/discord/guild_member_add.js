const memory = require('../../../shared/memory.js');
const discord = require('../../../shared/discord.js');
const features = require('../../../shared/features.js');
const raid_protection = require('../../../shared/raid_protection.js');
const role_management = require('../../../shared/role_management.js');
const sticky_nicknames = require('../../../shared/sticky_nicknames.js');

async function handle(payload) {
  let guild_id = payload.guild_id;
  let user_id = payload.user.id;
  return Promise.all([
    sendGreeting(guild_id, user_id),
    features.isActive(guild_id, 'raid protection').then(active => active ? raid_protection.on_guild_member_add(guild_id, user_id) : Promise.resolve()),
    features.isActive(guild_id, "role management").then(active => active ? role_management.on_guild_member_add(guild_id, user_id) : Promise.resolve()),
    features.isActive(guild_id, "sticky nicknames").then(active => active ? sticky_nicknames.on_guild_member_add(guild_id, user_id) : Promise.resolve())
  ]).then(() => undefined);
}

async function sendGreeting(guild_id, user_id) {
  if (await memory.get(`notification:role:guild:${guild_id}`, null)) return; // new member just joined, has no role by definition
  let me = await discord.me();
  let guild = await discord.guild_retrieve(guild_id);
  return discord.try_dms(user_id, `Hi <@${user_id}>, welcome to ${guild.name}! I'm your friendly neighborhood bot. I can play music, tell jokes, or schedule weekly events, whatever you need. Type \'<@${me.id}> help\' to learn how to talk to me. In case you talk to me in a DM channel, just skip the \'<@${me.id}>\'. I'm always around and happy to help.`);
}

// await memory.get(`notification:role:guild:${guild_id}`, null);

module.exports = { handle }
