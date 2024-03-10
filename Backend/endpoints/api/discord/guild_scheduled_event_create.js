const memory = require('../../../shared/memory.js');
const delayed_memory = require('../../../shared/delayed_memory.js');
const discord = require('../../../shared/discord.js');

async function handle(event) {
    if (await memory.get(`mute:activity:${event.name}`, false)) {
        return Promise.resolve();
    }

    return Promise.all([
            memory.get(`scheduled_events:post_public:guild:${event.guild_id}`, true)
                .then(post => post ? notifyGuild(event) : Promise.resolve()),
            memory.get(`scheduled_events:post_dm:guild:${event.guild_id}`, true)
                .then(post => post ? notifyMembers(event) : Promise.resolve())
        ]).then(() => undefined);
}

async function notifyGuild(event) {
    let link = discord.scheduledevent_link_create(event.guild_id, event.id);
    return discord.guild_retrieve(event.guild_id)
        .then(guild_details => discord.post(guild_details.system_channel_id, `There is a new event: **${event.name}** (${link}). Join if you can.`));
}


async function notifyMembers(event) {
    const mute_ttl = 60 * 60 * 24 * 7 * 4;
    let link = discord.scheduledevent_link_create(event.guild_id, event.id);
    return discord.guild_members_list(event.guild_id)
        .then(members => Promise.all(members.map(member =>
            Promise.all([
                memory.get(`mute:user:${member.user.id}`, false),
                memory.get(`mute:user:${member.user.id}:activity:${event.name}`, false),
                memory.get(`activities:all:user:${member.user.id}`, []).then(activities => {
                    let text = event.name + '\n' + (event.description ?? '');
                    for (let f = 0; f < text.length; f++) {
                        for (let t = f + 1; t <= text.length; t++) {
                            if (activities.includes(text.substring(f, t))) return false;
                        }
                    }
                    return true;
                }),
                discord.guild_member_has_permission(event.guild_id, event.channel_id, member.user.id, 'VIEW_CHANNELS').then(has => !has)
            ])
            .then(values => values.some(value => value) ? null : member))
        ))
        .then(promises => Promise.all(promises))
        .then(members => members.filter(member => member))
        .then(members => members.map(member =>
            Promise.all([
                delayed_memory.set(`response:` + memory.mask(`mute for me`) + `:user:${member.user.id}`, `mute:user:${member.user.id}`, true, mute_ttl),
                delayed_memory.set(`response:` + memory.mask(`mute for ${event.name}`) + `:user:${member.user.id}`, `mute:user:${member.user.id}:activity:${event.name}`, true, mute_ttl),
                discord.try_dms(
                    member.user.id,
                    `There is a new event you might be interested in: **${event.name}** (${link}). Respond with "mute for me" or "mute for ${event.name}" if you want me to stop notifying you for a while.`
                )
            ]))
        )
        .then(promises => Promise.all(promises));
}

module.exports = { handle }
  
