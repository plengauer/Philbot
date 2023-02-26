const memory = require('./memory.js');
const discord = require('./discord.js');
const synchronized = require('./synchronized.js');

// auto respond with emoji
// manually run rules

async function add_new_rule(guild_id, input) {
    let rule = await parse_rule(input, guild_id);
    return memory.get(memorykey(guild_id), [])
        .then(rules => rules.concat(rule))
        .then(rules => memory.set(memorykey(guild_id), rules));
}

// this is super inefficient parsing, yolo!
async function parse_rule(input, guild_id) {
    let split = input.indexOf('=');
    if (split < 0) throw new Error('A rule must have a ":" to separate the condition from the result!');
    return {
        condition: await parse_condition({ tokens: tokenize(input.substring(0, split)), cursor: 0 }, guild_id, true),
        actions: await parse_actions({ tokens: tokenize(input.substring(split + 1)), cursor: 0 }, guild_id, true)
    };
}

function tokenize(input) {
    const lookaheads = [ '<', '(', ')', ',' ];
    let tokens = [];
    let start = 0;
    for (let cursor = 0; cursor < input.length; cursor++) {
        if (input.charAt(cursor) == ' ' || lookaheads.some(lookahead => input.charAt(cursor) == lookahead)) {
            tokens.push(input.substring(start, cursor));
            start = cursor;
        }
    }
    tokens.push(input.substring(start));
    return tokens.map(token => token.trim()).filter(token => token.length > 0);
}

async function parse_condition(parser, guild_id, expectEOF = false) {
    let inner = await parse_condition_or(parser, guild_id);
    if (expectEOF && parser.cursor < parser.tokens.length) throw new Error('The rule is not valid!')
    return inner;
}

async function parse_condition_or(parser, guild_id) {
    let elements = [ await parse_condition_and(parser, guild_id) ];
    while (parser.cursor < parser.tokens.length && parser.tokens[parser.cursor] == 'or') {
        parser_next(parser);
        elements.push(await parse_condition_and(parser, guild_id));
    }
    return elements.length == 1 ? elements[0] : { type: 'or', inners: elements };
}

async function parse_condition_and(parser, guild_id) {
    let elements = [ await parse_condition_element(parser, guild_id) ];
    while (parser.cursor < parser.tokens.length && parser.tokens[parser.cursor] == 'and') {
        parser_next(parser);
        elements.push(await parse_condition_element(parser, guild_id));
    }
    return elements.length == 1 ? elements[0] : { type: 'and', inners: elements };
}

async function parse_condition_element(parser, guild_id) {
    switch (parser.tokens[parser.cursor]) {
        case 'role': return parse_trigger_role(parser, guild_id)
        case 'connect': return parse_trigger_connect(parser, guild_id);
        case 'disconnect': return parse_trigger_disconnect(parser);
        case 'reaction': return parse_trigger_reaction(parser, guild_id);
        case 'activity': return parse_trigger_activity(parser, guild_id);
        case 'not': return { type: parser_next(parser), inner: await parse_condition_element(parser, guild_id) };
        default: 
            if (parser.tokens[parser.cursor].startsWith('<') || parser.tokens[parser.cursor].startsWith('@')) return parse_trigger_role(parser, guild_id);
            else if (parser.tokens[parser.cursor].startsWith('(')) {
                parser_next(parser);
                let result = await parse_condition(parser, guild_id)
                if (parser_next(parser) != ')') throw new Error('The rule is missing a ")"!');
                return result;
            } else throw new Error('The rule does not allow "' + parser_next(parser) + '"!');
    }
}

async function parse_trigger_reaction(parser, guild_id) {
    if (parser_next(parser) != 'reaction') throw new Error('Expected "reaction"');
    // https://discord.com/channels/${guild_id}/${channel_id}/${message_id}
    let emoji = parser_next(parser);
    let link = parser_next(parser);
    let link_tokens = link.split('/').filter(token => token.trim().length > 0).slice(-3);
    let link_guild_id = link_tokens[0];
    let link_channel_id = link_tokens[1];
    let link_message_id = link_tokens[2];
    if (guild_id != link_guild_id) throw new Error('The message is from a different server!');
    if (!(await discord.guild_channels_list(guild_id)).some(channel => channel.id == link_channel_id)) throw new Error('The channel of the message does not exist!');
    if (!(await discord.message_retrieve(link_channel_id, link_message_id).then(() => true).catch(() => false))) throw new Error('The message does not exist!');
    try {
        await discord.reaction_create(link_channel_id, link_message_id, emoji);
    } catch {
        // just swallow
    }
    return { type: 'reaction', channel_id: link_channel_id, message_id: link_message_id, emoji: emoji };
}

async function parse_trigger_role(parser, guild_id) {
    let role_string = parser_next(parser);
    let role_id = null;
    if (role_string == '@everyone') {
        role_id = guild_id;
    } else if (role_string == 'role') {
        role_string = parser_next(parser);
        role_id = await discord.guild_roles_list(guild_id).then(roles => roles.find(role => role.name == role_string)?.id);
        if (!role_id) throw new Error('I cannot find the role ' + role_string + '!');
    } else if (role_string.startsWith('@')) {
        role_string = role_string.substring(1);
        role_id = await discord.guild_roles_list(guild_id).then(roles => roles.find(role => role.name == role_string)?.id);
        if (!role_id) throw new Error('I cannot find the role ' + role_string + '!');
    } else {
        role_id = discord.parse_role(role_string);
        if (!role_id || !(await discord.guild_roles_list(guild_id)).some(role => role.id == role_id)) throw new Error('I cannot find the role ' + role_string + '!');
    }
    return { type: "role", role_id: role_id };
}

async function parse_trigger_connect(parser, guild_id) {
    if (parser_next(parser) != 'connect') throw new Error('Expected "connect"');
    let channel_name = parser_next(parser);
    let channel_id = null;
    if (channel_name == 'any') {
        channel_id = null;
    } else {
        channel_id = await discord.guild_channels_list(guild_id).then(channels => channels.find(channel => channel.name == channel_name));
        if (!channel_id) throw new Error('I cannot find the channel ' + channel_name + '!');
    }
    return { type: 'connect', channel_id: channel_id };
}

async function parse_trigger_activity(parser, guild_id) {
    if (parser_next(parser) != 'activity') throw new Error('Expected "activity"');
    return { type: 'activity', activity: parser_next(parser) };
}

async function parse_trigger_disconnect(parser) {
    if (parser_next(parser) != 'disconnect') throw new Error('Expected "disconnect"');
    return { type: 'disconnect' };
}

async function parse_actions(parser, guild_id) {
    let actions = [ await parse_condition_element(parser, guild_id) ];
    while (parser.cursor < parser.tokens.length) {
        if (parser_next(parser) != ',') throw new Error('The actions of a rule must be separated by ","!');
        actions.push(await parse_condition_element(parser, guild_id));
    }
    if (parser.cursor < parser.tokens.length) throw new Error('The rule is not valid!')
    return actions;
}

function parser_next(parser) {
    if (parser.cursor >= parser.tokens.length) throw new Error('The rule is incomplete!')
    return parser.tokens[parser.cursor++];
}

async function on_guild_member_add(guild_id, user_id) {
    return on_event(guild_id, user_id);
}

async function on_guild_member_roles_update(guild_id, user_id) {
    return on_event(guild_id, user_id);
}

async function on_reaction_add(guild_id, user_id) {
    return on_event(guild_id, user_id);
}

async function on_reaction_remove(guild_id, user_id) {
    return on_event(guild_id, user_id);
}

async function on_voice_state_update(guild_id, user_id, channel_id) {
    return on_event(guild_id, user_id, { type: channel_id ? 'connect' : 'disconnect', channel_id: channel_id });
}

async function on_presence_update(guild_id, user_id, activity) {
    return on_event(guild_id, user_id, { type: 'activity', activity: activity });
}

async function on_event(guild_id, user_id, event = undefined) {
    let me = await discord.me();
    if (me.id == user_id) return;
    return execute(guild_id, user_id, event);
}

async function update_all(guild_id) {
    return discord.guild_members_list(guild_id)
        .then(members => members.map(member => member.user.id))
        .then(user_ids => Promise.all(user_ids.map(user_id => on_event(guild_id, user_id))));
}

async function execute(guild_id, user_id, event) {
    return synchronized.locked('role_management:execute_rule:guild:' + guild_id + ':user:' + user_id, () => 
        memory.get(memorykey(guild_id), [])
    	    .then(rules => Promise.all(rules.map(rule => evaluate(rule.condition, guild_id, user_id, event).then(expected => expected != undefined ? Promise.all(rule.actions.map(action => extract(action, expected, guild_id, user_id))) : []))))
    	    .then(actionss => reduce(actionss.flatMap(actions => actions).filter(action => !!action)))
            .then(actions => Promise.all(actions.map(action => apply(action, guild_id, user_id))))
    );
}

async function evaluate(condition, guild_id, user_id, event) {
    switch(condition.type) {
        case 'and': return Promise.all(condition.inners.map(inner => evaluate(inner, guild_id, user_id, event))).then(results => results.every(result => result != undefined) ? results.every(result => !!result) : undefined);
        case 'or': return Promise.all(condition.inners.map(inner => evaluate(inner, guild_id, user_id, event))).then(results => results.every(result => result != undefined) ? results.some(result => !!result) : undefined);
        case 'not': return evaluate(condition.inner, guild_id, user_id, event).then(result => !result);
        case 'role': return discord.guild_member_has_role(guild_id, user_id, condition.role_id);
        case 'reaction': return discord.reactions_list(condition.channel_id, condition.message_id, condition.emoji).then(users => users.some(user => user.id == user_id));
        case 'connect': return (event && event.type == 'connect' && (!condition.channel_id || condition.channel_id == event.channel_id)) ? true : undefined;
        case 'disconnect': return (event && event.type == 'disconnect') ? true : undefined;
        case 'activity': return (event && event.type == 'activity' && event.activity == condition.activity) ? true : undefined;
        default: throw new Error('Unknown condition type: ' + condition.type + '!');
    }
}

async function extract(action, expected, guild_id, user_id) {
    switch (action.type) {
        case 'not': return extract(action.inner, !expected, guild_id, user_id);
        case 'role':
            let actual = await discord.guild_member_has_role(guild_id, user_id, action.role_id);
            if (expected == actual) return null;
            else if (expected && !actual) return action.role_id;
            else if (!expected && actual) return '!' + action.role_id;
            else throw new Error('Here be dragons!');
        default: throw new Error('Role actions may only be actions and roles, but was ' + action.type + '!');
    }
}

function reduce(actions, guild_id) {
    let result = [];
    for (let action of actions) {
        if (result.includes(action.startsWith('!') ? action.substring(1) : ('!' + action))) continue; // TODO notify?
        if (action == '!' + guild_id) return [ action ];
        result.push(action);
    }
    return result;
}

async function apply(action, guild_id, user_id) {
    if (action.startsWith('!')) return guild_member_role_unassign(guild_id, user_id, action.substring(1));
    else return guild_member_role_assign(guild_id, user_id, action);
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

function memorykey(guild_id) {
    return `role_management:rules:guild:${guild_id}`;
}

async function clean() {
    // clean all configs where either the message or the roles or the guilds do not exist anymore
    // there are just too many ways that we need to react (message delete, message bulk delete, role delete, channel delete, guild delete)
}

async function to_string(guild_id) {
    return 'Automatic Role Rules:\n'
        + await memory.get(memorykey(guild_id), [])
            .then(rules => rules.map(rule => rule_to_string(rule, guild_id)))
            .then(promises => Promise.all(promises))
            .then(strings => strings.join('\n'))
        ;
}

async function rule_to_string(rule, guild_id) {
    return (await condition_to_string(rule.condition, guild_id)) + ' = ' + (await Promise.all(rule.actions.map(action => condition_to_string(action)))).join(',')
}

async function condition_to_string(condition, guild_id) {
    switch(condition.type) {
        case 'and': return '(' + (await Promise.all(condition.inners.map(inner => condition_to_string(inner, guild_id)))).join(' and ') + ')';
        case 'or': return '(' + (await Promise.all(condition.inners.map(inner => condition_to_string(inner, guild_id)))).join(' or ') + ')';
        case 'not': return 'not ' + await condition_to_string(condition.inner, guild_id);
        case 'role': return discord.mention_role(condition.role_id);
        case 'reaction': return condition.emoji + ' ' + discord.message_link_create(guild_id, condition.channel_id, condition.message_id);
        case 'connect': return 'connect ' + (condition.channel_id ? (await discord.guild_channels_list(guild_id).then(channels => channels.find(channel => channel.id == condition.channel_id)))?.name : 'any');
        case 'disconnect': return 'disconnect';
        case 'activity': return 'activity ' + condition.activity;
        default: throw new Error('Unknown condition type: ' + condition.type + '!');
    }
}

module.exports = {
    add_new_rule,
    on_reaction_add, on_reaction_remove,
    on_guild_member_add,
    on_guild_member_roles_update,
    on_presence_update,
    on_voice_state_update,
    update_all,
    clean, to_string
}
