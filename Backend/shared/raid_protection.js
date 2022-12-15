const lib = require('lib')({token: process.env.STDLIB_SECRET_TOKEN});
const memory = require('./memory.js');
const discord = require('./discord.js');
const permissions = require('./permissions.js');

//TODO think about forencis, can we find out who is the origin
// maybe if it continues find creator of invite? or list all people who can still invite

async function lockdown(guild_id) {
  return discord.guild_retrieve(guild_id)
    .then(guild => Promise.all([
        memory.set(`raid_protection:lockdown:guild:${guild_id}`, true, 60 * 60 * 24 * 7),
        notify_raid(guild),
        revoke_invite_permissions(guild),
        revoke_invites(guild),
        kick_and_ban_suspects(guild),
        slowdown_channels(guild)
      ]).then(actions => notify_lockdown(guild, actions[2], actions[3], actions[4])));
}

async function all_clear(guild_id) {
  return memory.set(`raid_protection:lockdown:guild:${guild_id}`, false, 60 * 60 * 24)
    .then(() => discord.guild_retrieve(guild_id))
    .then(guild => notify_moderators(guild_id, `The **lockdown** for the server **${guild.name}** has been **lifted**.`));
}

async function notify_raid(guild) {
  return notify_moderators(guild.id, `**ATTENTION**: The server **${guild.name}** is being **raided**. That means that an unusual amount of new members have joined in a short time and start spamming. I'm taking automatic action to protect the server and its members.`);
}

async function revoke_invite_permissions(guild) {
  return discord.guild_roles_list(guild.id)
    .then(roles => roles.filter(role => permissions.decompile(role.permissions).includes('CREATE_INVITE')).map(role => discord.retry_with_rate_limit(() => lib.discord.guilds['@0.2.4'].roles.update({
        guild_id: guild.id,
        role_id: role.id,
        name: role.name,
        permissions: permissions.compile(permissions.decompile(role.permissions).filter(permission => permission != 'CREATE_INVITE')),
        color: role.color,
        hoist: role.hoist,
        mentionable: role.mentionable
      })).then(() => role).catch(e => null)))
    .then(promises => Promise.all(promises))
    .then(roles => roles.filter(role => !!role));
}

async function revoke_invites(guild) {
  return lib.discord.invites['@0.1.0'].list({ guild_id: guild.id })
    .then(invites => invites.map(invite => discord.retry_with_rate_limit(() => lib.discord.invites['@0.1.0'].destroy({ invite_code: invite.code })).then(() => invite))) // TODO we can check how often it was used maybe and who created it? or what role
    .then(promises => Promise.all(promises));
}

async function kick_and_ban_suspects(guild) {
  return discord.guild_members_list(guild.id)
    .then(members => members.filter(member => new Date(member.joined_at) > new Date(Date.now() - 1000 * GUILD_MEMBER_SUSPECT_TIMEFRAME)))
    .then(suspects => suspects.map(suspect => kick_and_ban_user(guild.id, member.user.id).then(() => suspect)))
    .then(promises => Promise.all(promises));
}

async function kick_and_ban_user(guil_id, user_id) {
  return discord.retry_with_rate_limit(() => lib.discord.guilds['@0.2.4'].members.destroy({ guild_id: guild_id, user_id: user_id }))
    .then(() => discord.retry_with_rate_limit(() => lib.discord.guilds['@0.2.4'].bans.create({ guild_id: guild_id, user_id: user_id, reason: 'suspect about contribution to a raid' })));
}

async function slowdown_channels(guild) {
  return Promise.resolve(); // i dont find a way to do this
}

async function notify_lockdown(guild, roles_with_revoked_permissions, invites_invalidated, members_kicked) {
  return notify_moderators(guild.id, `The server **${guild.name}** is now in **lockdown**.`
      + (roles_with_revoked_permissions.length > 0 ? ' The \'Create Invite\' permission of the roles ' + roles_with_revoked_permissions.map(role => role.name).join(', ') + ' has been revoked. Be aware, that the server owner and administrators can always create new invites.' : '')
      + (invites_invalidated.length > 0 ? ' The invites ' + invites_invalidated.map(invite => invite.code).join(', ') + ' have been invalidated.' : '' )
      + (members_kicked.length > 0 ? ' The members ' + members_kicked.map(member => member.user.username + '#' + member.user.discriminator).join(', ') + ' have been kicked and banned.' : '')
      + ' No new users are allowed to join while the server is in lockdown. If users try joining nonetheless, they will be banned. Bans can be lifted manually after the lockdown via the server settings.'
      + ' You should try to find the culprit inviting raiders to the server. You can also prevent raids by reviewing and restricting permissions so that new members cannot spam voice or text channels.'
      + ' When you have reviewed the servers permissions, roles and members and you feel safe again, you can sound the all clear with the command \'raid all clear\' and lift the lockdown.'
    );
}

async function notify_moderators(guild_id, text) {
  return list_moderators(guild_id).then(mods => mods.map(mod => discord.try_dms(mod.user.id, text))).then(promises => Promise.all(promises)); //TODO if no moderator is reachable, put it in general chat, if no general channel is available, post it somewhere
}

async function list_moderators(guild_id) {
  return discord.guild_members_list_with_any_permission(guild_id, [ 'ADMINISTRATOR', 'MANAGE_SERVER', 'MANAGE_ROLES', 'MANAGE_CHANNELS', 'MODERATE_MEMBERS', 'KICK_MEMBERS', 'BAN_MEMBERS' ]);
}

const GUILD_MEMBER_SUSPECT_TIMEFRAME = 60 * 60 * 24;
const GUILD_MESSAGE_CREATE_THRESHOLD = 100;
const GUILD_MESSAGE_CREATE_THRESHOLD_TIMEFRAME = 60 * 60;

async function on_guild_member_added(guild_id, user_id) {
  return memory.get(`raid_protection:lockdown:guild:${guild_id}`, false).then(lockdown => lockdown ? kick_and_ban_user(guild_id, user_id) : Promise.resove());
}

async function on_guild_message_created(guild_id, user_id) {
  if (await memory.get(`raid_protection:lockdown:guild:${guild_id}`, false)) {
    return undefined;
  }
  let members = await discord.guild_members_list(guild_id);
  let suspects = members.filter(member => new Date(member.joined_at) > new Date(Date.now() - 1000 * GUILD_MEMBER_SUSPECT_TIMEFRAME));
  if (!suspects.some(suspect => suspect.user.id == user_id)) {
    return undefined;
  }
  const key = `raid_protection:detection:guild.message.create:guild:${guild_id}`;
  let counter = await memory.get(key, 0, GUILD_MESSAGE_CREATE_THRESHOLD_TIMEFRAME);
  if (counter < GUILD_MESSAGE_CREATE_THRESHOLD) return memory.set(key, counter + 1, GUILD_MESSAGE_CREATE_THRESHOLD_TIMEFRAME * 1000 - Date.now() % (GUILD_MESSAGE_CREATE_THRESHOLD_TIMEFRAME * 1000));
  return lockdown(guild_id);
}

module.exports = { lockdown, all_clear, on_guild_member_added, on_guild_message_created }
