const memory = require('./memory.js');
const discord = require('./discord.js');

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
    let role_check_simple = role_id => role_id == guild_id || user_role_ids.includes(role_id);
    let role_check = role_id => role_id.startsWith('!') ? !role_check_simple(role_id.substring(1)) : role_check_simple(role_id) ;
    let expected = config.all ? config.condition_role_ids.every(role_check) : config.condition_role_ids.some(role_check);
    return evaluate(guild_id, user_id, config.result_role_id, expected);
}

function role_trigger_memorykey(guild_id) {
    return `role_management:config:trigger:role:guild:${guild_id}`;
}

async function add_reaction_trigger(guild_id, channel_id, message_id, emoji, role_id) {
    return discord.react(channel_id, message_id, emoji)
        .catch(e => {/* ignore me */})
        .then(() => memory.get(reaction_trigger_memorykey(guild_id), []))
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
    return evaluate(guild_id, user_id, config.result_role_id, added);
}

function reaction_trigger_memorykey(guild_id) {
    return `role_management:config:trigger:reaction:guild:${guild_id}`;
}

async function add_voice_trigger(guild_id, channel_id, role_id) {
    return memory.get(voice_trigger_memorykey(guild_id), [])
        .then(configs => configs.concat([{ condition_channel_id: channel_id, result_role_id: role_id }]))
        .then(configs => memory.set(voice_trigger_memorykey(guild_id), configs));
}

async function on_voice_state_update(guild_id, user_id, channel_id) {
    return memory.get(voice_trigger_memorykey(guild_id), [])
        .then(configs => Promise.all(configs.map(config => evaluate_config_on_voice_state_update(config, guild_id, user_id, channel_id))))
}

async function evaluate_config_on_voice_state_update(config, guild_id, user_id, channel_id) {
    return evaluate(guild_id, user_id, config.result_role_id, channel_id && (!config.condition_channel_id || config.condition_channel_id == channel_id));
}

function voice_trigger_memorykey(guild_id) {
    return `role_management:config:trigger:voice:guild:${guild_id}`;
}

async function evaluate(guild_id, user_id, role_id, expected) {
    let negate = role_id.startsWith('!');
    if (negate) {
        role_id = role_id.substring(1);
        expected = !expected;
    }
    let actual = await discord.guild_member_has_role(guild_id, user_id, role_id);
    if (expected == actual) return; // all is fine
    else if (expected && !actual) return guild_member_role_assign(guild_id, user_id, role_id);
    else if (!expected && actual) return guild_member_role_unassign(guild_id, user_id, role_id);
    else throw new Error('Here be dragons!');
}

async function guild_member_role_assign(guild_id, user_id, role_id) {
    if (guild_id == role_id) return; // everbody is @everyone
    return discord.guild_member_role_assign(guild_id, user_id, role_id)
        .catch(error => report_failure(guild_id, user_id, role_id, true));
}

async function guild_member_role_unassign(guild_id, user_id, role_id) {
    if (guild_id == role_id) return discord.guild_member_kick(guild_id, user_id); // if we remove @everyone, that means kicking
    return discord.guild_member_role_unassign(guild_id, user_id, role_id)
        .catch(error => report_failure(guild_id, user_id, role_id, false));
}

async function report_failure(guild_id, user_id, role_id, assign) {
    let me = await discord.me();
    let guild = await discord.guild_retrieve(guild_id);
    let reportees = await discord.guild_members_list_with_permission(guild_id, 'MANAGE_SERVER');
    let role = await discord.guild_role_retrieve(guild_id, role_id);
    let member = await discord.guild_member_retrieve(guild_id, user_id);
    let operation = assign ? 'assign' : 'unassign';
    let report = `I failed to ${operation} the role **${role.name}** to **${member.nick ?? member.user.username}** in ${guild.name}.`
        + ` This can happen if I dont have enough permissions or my role is not ranked higher than the roles im supposed to ${operation}.`
        + ` Please assign the role manually.`
        + ` To avoid similar issues in the future, make sure that my own role (${me.username}) has the "Manage Roles" permission and that it is ranked higher than any role you want me to auto-assign.`;
    return Promise.all(reportees.map(reportee => discord.try_dms(reportee.user.id, report)));
}

async function clean() {
    // clean all configs where either the message or the roles or the guilds do not exist anymore
    // there are just too many ways that we need to react (message delete, message bulk delete, role delete, channel delete, guild delete)
}

async function summary(guild_id) {
    let channels = await discord.guild_channels_list(guild_id);
    return 'Automatic Role Management Rules:\n'
        + await memory.get(reaction_trigger_memorykey(guild_id), [])
            .then(configs => configs.map(config => 'Message ' + discord.message_link_create(guild_id, config.trigger_channel_id, config.trigger_message_id) + ` ${config.emoji} => ` + discord.mention_role(config.result_role_id)))
            .then(summaries => summaries.join('\n'))
        + '\n'
        + await memory.get(voice_trigger_memorykey(guild_id), [])
            .then(configs => configs.map(config => (config.condition_channel_id ? 'Channel ' + channels.find(channel => channel.id == config.condition_channel_id) : 'any') + ` => ` + discord.mention_role(config.result_role_id)))
            .then(summaries => summaries.join('\n'))
        + '\n'
        + await memory.get(role_trigger_memorykey(guild_id), [])
            .then(configs => configs.map(config => config.condition_role_ids.map(role_id => discord.mention_role(role_id)).join(config.all ? ' and ' : ' or ') + ` => ` + discord.mention_role(config.result_role_id)))
            .then(summaries => summaries.join('\n'))
        ;
}

module.exports = {
    add_reaction_trigger, on_reaction_add, on_reaction_remove,
    add_role_trigger, on_guild_member_roles_update,
    add_voice_trigger, on_voice_state_update,
    clean, summary
}
