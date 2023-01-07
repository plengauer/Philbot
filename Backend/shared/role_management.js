const memory = require('./memory.js');
const discord = require('./discord.js');

async function add_reaction_trigger(guild_id, channel_id, message_id, emoji, role_id) {
    return memory.get(reaction_trigger_memorykey(guild_id), [])
        .then(configs => configs.filter(config => config.message_id != message_id && config.emoji != emoji).concat([{ trigger_channel_id: channel_id, trigger_message_id: message_id, emoji: emoji, result_role_id: role_id }]))
        .then(configs => memory.set(reaction_trigger_memorykey(guild_id), configs));
}

async function on_reaction_add(guild_id, channel_id, message_id, user_id, emoji) {
    let configs = await memory.get(reaction_trigger_memorykey(guild_id, message_id, emoji), []);
    for (let config of configs) {
        if (config.trigger_channel_id != channel_id) continue;
        if (config.trigger_message_id != message_id) continue;
        if (config.emoji != emoji) continue;
        await evaluate_config_on_reaction_update(config, guild_id, user_id, true);
    }
}

async function on_reaction_remove(guild_id,channel_id, message_id, user_id, emoji) {
    let configs = await memory.get(reaction_trigger_memorykey(guild_id, message_id, emoji), []);
    for (let config of configs) {
        if (config.trigger_channel_id != channel_id) continue;
        if (config.trigger_message_id != message_id) continue;
        if (config.emoji != emoji) continue;
        await evaluate_config_on_reaction_update(config, guild_id, user_id, false);
    }
}

async function evaluate_config_on_reaction_update(config, guild_id, user_id, added) {
    let member = await discord.guild_member_retrieve(guild_id, user_id);
    let expected = added;
    let actual = member.roles.includes(config.result_role_id);
    if (expected == actual) return; // all is fine
    else if (expected && !actual) return discord.guild_member_role_assign(guild_id, user_id, config.result_role_id);
    else if (!expected && actual) return discord.guild_member_role_unassign(guild_id, user_id, config.result_role_id);
    else throw new Error('Here be dragons!');
}

function reaction_trigger_memorykey(guild_id) {
    return `role_management:config:trigger:reaction:guild:${guild_id}:`;
}

async function add_role_trigger(guild_id, role_ids, all, role_id) {
    return memory.get(role_trigger_memorykey(guild_id), [])
        .then(configs => configs.concat([{ condition_role_ids: role_ids, all: all, result_role_id: role_id }]))
        .then(configs => memory.set(role_trigger_memorykey(guild_id), configs));
}

async function on_guild_member_roles_update(guild_id, user_id, role_ids) {
    return memory.get(role_trigger_memorykey(guild_id), [])
        .then(configs => Promise.all(configs.map(config => evaluate_config_on_role_update(config, guild_id, user_id, role_ids))))
}

async function evaluate_config_on_role_update(config, guild_id, user_id, user_role_ids) {
    let expected = config.all ? config.condition_role_ids.every(role_id => role_id == guild_id || user_role_ids.includes(role_id)) : config.condition_role_ids.some(role_id => role_id == guild_id || user_role_ids.includes(role_id));
    let actual = user_role_ids.includes(config.result_role_id);
    if (expected == actual) return; // all is fine
    else if (expected && !actual) return discord.guild_member_role_assign(guild_id, user_id, config.result_role_id);
    else if (!expected && actual) return discord.guild_member_role_unassign(guild_id, user_id, config.result_role_id);
    else throw new Error('Here be dragons!');
}

function role_trigger_memorykey(guild_id) {
    return `role_management:config:trigger:role:guild:${guild_id}`;
}

async function clean() {
    // clean all configs where either the message or the roles or the guilds do not exist anymore
    // there are just too many ways that we need to react (message delete, message bulk delete, role delete, channel delete, guild delete)
}

async function summary(guild_id) {
    return 'Automatic Role Management Rules:\n'
        + await memory.get(reaction_trigger_memorykey(guild_id), [])
            .then(configs => configs.map(config => discord.message_link_create(guild_id, config.trigger_channel_id, config.trigger_message_id) + ` ${config.emoji} => ` + discord.mention_role(config.result_role_id)))
            .then(summaries => summaries.join('\n'))
        + '\n'
        + await memory.get(role_trigger_memorykey(guild_id), [])
            .then(configs => configs.map(config => config.condition_role_ids.map(role_id => discord.mention_role(role_id)).join(config.all ? ' & ' : ' | ') + ` => ` + discord.mention_role(config.result_role_id)))
            .then(summaries => summaries.join('\n'))
        ;
}

module.exports = {
    add_reaction_trigger, on_reaction_add, on_reaction_remove,
    add_role_trigger, on_guild_member_roles_update,
    clean, summary
}
