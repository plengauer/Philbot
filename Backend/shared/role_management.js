const memory = require('./memory.js');
const discord = require('./discord.js');

async function configure(guild_id, channel_id, message_id, emoji, role_id) {
    return memory.get(memorykey(guild_id, channel_id, message_id), [])
        .then(configs => configs.filter(config => config.emoji != emoji).concat([{ emoji: emoji, role_id: role_id }]))
        .then(configs => memory.set(memorykey(guild_id, channel_id, message_id), configs));
}

async function on_reaction_add(guild_id, channel_id, message_id, user_id, emoji) {
    let configs = await memory.get(memorykey(guild_id, channel_id, message_id, emoji), []);
    for (let config of configs) {
        if (config.emoji != emoji) continue;
        let member = await discord.guild_member_retrieve(guild_id, user_id);
        if (member.roles.includes(config.role_id)) continue;
        await discord.guild_member_role_assign(guild_id, member.user.id, config.role_id);
    }
}

async function on_reaction_remove(guild_id, channel_id, message_id, user_id, emoji) {
    let configs = await memory.get(memorykey(guild_id, channel_id, message_id, emoji), []);
    for (let config of configs) {
        if (config.emoji != emoji) continue;
        let member = await discord.guild_member_retrieve(guild_id, user_id);
        if (!member.roles.includes(config.role_id)) continue;
        await discord.guild_member_role_unassign(guild_id, member.user.id, config.role_id);
    }
}

async function clean() {
    // clean all configs where either the message or the roles do not exist anymore
}

function memorykey(guild_id, channel_id, message_id) {
    return `role_management:config:guild:${guild_id}:channel:${channel_id}:message:${message_id}`;
}

module.exports = { configure, on_reaction_add, on_reaction_remove, clean }
