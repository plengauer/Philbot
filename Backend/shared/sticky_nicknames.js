const memory = require('./memory.js');
const discord = require('./discord.js');

async function on_guild_member_update(guild_id, user_id) {
  return discord.guild_member_retrieve(guild_id, user_id).then(member => memory.set(key(guild_id, user_id), member.nick, 60 * 60 * 24 * 365));
}

async function on_guild_member_add(guild_id, user_id) {
  return memory.get(key(guild_id, user_id)).then(nick => nick ? discord.guild_member_nick_update(guild_id, user_id, nick) : Promise.resolve());
}

function key(guild_id, user_id) {
  return `sticky_nickname:guild:${guild_id}:user:${user_id}`;
}

module.exports = { on_guild_member_update, on_guild_member_add }
