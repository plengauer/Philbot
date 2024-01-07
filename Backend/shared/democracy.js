const memory = require('./memory.js');
const discord = require('./discord.js');
const synchronized = require('./synchronized.js');

async function register(new_key) {
    return synchronized.locked(globalkey(), async() => memory.get(globalkey(), []).then(keys => keys.concat([new_key])).then(keys => memory.set(globalkey(), keys, 60 * 60 * 24 * 7 * 4)))
}

async function deregister(closed_key) {
    return synchronized.locked(globalkey(), async() => memory.get(globalkey(), []).then(keys => keys.filter(key => key != closed_key)).then(keys => memory.set(globalkey(), keys, 60 * 60 * 24 * 7 * 4)))
}

async function list() {
    return synchronized.locked(globalkey(), async () => memory.get(globalkey(), []));
}

function globalkey() {
    return 'democracy.votes.index';
}

async function startVote(guild_id, channel_id, message_id, title, text, end, choices, role_ids = [], user_ids = []) {
    for (let role_id of role_ids) {
        for (let member of await discord.guild_members_list(guild_id, role_id)) {
            user_ids.push(member.user.id);
        }
    }
    user_ids = Array.from(new Set(user_ids));

    let data = {
        guild_id: guild_id,
        channel_id: channel_id,
        message_id: message_id,
        end: end,
        title: title,
        choices: choices,
        voter_count: user_ids.length,
        voters: user_ids,
        votes: []
    };
    await memory.set(key(guild_id, message_id), data, 60 * 60 * 24 * 7 * 4);
    await register(key(guild_id, message_id));

    let components = createComponents(guild_id, message_id, choices)
    return Promise.all(user_ids.map(user_id => discord.dms_channel_retrieve(user_id).then(dm_channel => discord.post(dm_channel.id, `Vote **${title}**\n${text}`, undefined, true, [], components, []))));
}

function createComponents(guild_id, message_id, choices) {
    let components = [];
    for (let index = 0; index < choices.length; index++) {
        if (index % 5 == 0) {
            components.push({ type: 1, components: [] });
        }
        components[components.length - 1].components.push({ type: 2, style: 2, label: choices[index], custom_id: key(guild_id, message_id) + ':choice:' + index });
    }
    return components;
}

async function onInteraction(guild_id, channel_id, user_id, message_id, interaction_id, interaction_token, data) {
    let custom = data.custom_id;
    let key = custom.substring(0, custom.indexOf(':choice:'));
    let choice_index = parseInt(custom.substring(custom.lastIndexOf(':') + 1));
    return synchronized.locked(key, async () => {
        let data = await memory.get(key, null);
        if (!data) return;
        if (Date.now > data.end) return;
        if (!data.voters.includes(user_id)) return;
        let choice = data.choices[choice_index];
        data.voters = data.voters.filter(voter => voter != user_id);
        data.votes.push(choice);
        await memory.set(key, data, 1000 * 60 * 60 * 24 * 7 * 4);
        await discord.interact(interaction_id, interaction_token);
        let message = await discord.message_retrieve(channel_id, message_id);
        for (let row of message.components) {
            if (row.type != 1) continue;
            for (let component of row.components) {
                if (component.type != 2) continue;
                component.disabled = true;
                if (component.label == choice) {
                    component.emoji = { name: '✅' };
                }
            }
        }
        await discord.message_update(channel_id, message_id, message.content, message.embeds, message.components);
        return data;
    }).then(data => data && data.votes.length == data.voter_count ? endVote(data.guild_id, data.channel_id, data.message_id) : undefined);
}

async function remindVoters(guild_id, channel_id, message_id) {
    return synchronized.locked(key(guild_id, message_id), async () => {
        let data = await memory.get(key(guild_id, message_id));
        if (!data) return;
        // TODO check wether the time is right!
        return Promise.all(data.voters.map(user_id =>
            discord.dms_channel_retrieve(user_id)
                .then(dm_channel => discord.messages(dm_channel.id))
                .then(messages => messages.find(message => message.content.includes(`**${data.title}**`))) // this is best effort and could be wrong!
                .then(message => Promise.resolve()) // TODO send reminder in reply to vote!
        ));
    });
}

async function endVote(guild_id, channel_id, message_id) {
    return synchronized.locked(key(guild_id, message_id), async () => {
        let data = await memory.get(key(guild_id, message_id));
        if (!data) return;
        
        let winner_index = -1;
        let totals = data.voter_count;
        let counts = [];
        for (let index = 0; index < data.choices.length; index++) {
            counts[index] = data.votes.filter(choice => choice == data.choices[index]).length;
            if (winner_index < 0 || counts[index] > counts[winner_index]) winner_index = index;
        }
        let invalids = data.votes.filter(choice => !data.choices.includes(choice)).length;
        let nones = totals - counts.reduce((a, b) => a + b, invalids);
        
        let result = `Vote **${data.title}** Result:\n`;
        result += `(${totals - nones} valid votes, ${invalids} invalid votes, ${nones} no votes)\n`
        for (let index = 0; index < data.choices.length; index++) {
            let relative = (counts[index] * 100 / (totals - nones));
            result += `\n${relative.toFixed(2)}% ${data.choices[index]}`;
        }
        result += `\n\n**Winner: ${data.choices[winner_index]}**`;
        await discord.respond(channel_id, message_id, result).finally(() => memory.unset(key(guild_id, message_id)));

        await deregister(key(guild_id, message_id));
        await memory.unset(key(guild_id, message_id));
    });
}

function key(guild_id, message_id) {
    return `democracy:vote:guild:${guild_id}:id:${message_id}`;
}

async function tick() {
    return list()
        .then(keys => Promise.all(keys.map(key => memory.get(key).then(data => data && Date.now > data.end ? endVote(data.guild_id, data.channel_id, data.message_id) : remindVoters(data.guild_id, data.channel_id, data.message_id)))));
}

module.exports = { startVote, endVote, onInteraction, tick }
