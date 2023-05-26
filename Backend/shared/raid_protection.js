const memory = require('./memory.js');
const discord = require('./discord.js');
const permissions = require('./permissions.js');
const synchronized = require('./synchronized.js');

const GUILD_MEMBER_SUSPECT_TIMEFRAME = 60 * 60 * 24;
const GUILD_MESSAGE_CREATE_THRESHOLD = 100;
const GUILD_MESSAGE_CREATE_THRESHOLD_TIMEFRAME = 60 * 60;

async function on_guild_member_add(guild_id, user_id) {
  return memory.get(`raid_protection:lockdown:guild:${guild_id}`, false).then(lockdown => lockdown ? kick_and_ban_user(guild_id, user_id) : Promise.resolve());
}

async function on_guild_message_create(guild_id, channel_id, user_id, message_id) {
  return Promise.all([
    on_guild_message_create_for_raid_protection(guild_id, user_id),
    on_guild_message_create_for_scam_protection(guild_id, channel_id, message_id)
  ]);
}

//TODO think about forencis, can we find out who is the origin
// maybe if it continues find creator of invite? or list all people who can still invite

async function on_guild_message_create_for_raid_protection(guild_id, user_id) {
  return synchronized(`raid_protection:guild:${guild_id}`, () => on_guild_message_create_0(guild_id, user_id));
}

async function on_guild_message_create_0(guild_id, user_id) {
  if (await memory.get(`raid_protection:lockdown:guild:${guild_id}`, false)) return;
  let members = await discord.guild_members_list(guild_id);
  let suspects = members.filter(member => new Date(member.joined_at) > new Date(Date.now() - 1000 * GUILD_MEMBER_SUSPECT_TIMEFRAME));
  if (!suspects.some(suspect => suspect.user.id == user_id)) return;
  const key = `raid_protection:detection:guild.message.create:guild:${guild_id}`;
  let counter = await memory.get(key, 0, GUILD_MESSAGE_CREATE_THRESHOLD_TIMEFRAME);
  if (counter < GUILD_MESSAGE_CREATE_THRESHOLD) return memory.set(key, counter + 1, GUILD_MESSAGE_CREATE_THRESHOLD_TIMEFRAME * 1000 - Date.now() % (GUILD_MESSAGE_CREATE_THRESHOLD_TIMEFRAME * 1000));
  return lockdown(guild_id);
}

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
    .then(roles => roles.filter(role => permissions.decompile(role.permissions).includes('CREATE_INVITE')).map(role => discord.guild_role_modify(
        guild.id, role.id, role.name,
        permissions.compile(permissions.decompile(role.permissions).filter(permission => permission != 'CREATE_INVITE')),
        role.hoist, role.mentionable).then(() => role).catch(e => null))
      )
    .then(promises => Promise.all(promises))
    .then(roles => roles.filter(role => !!role));
}

async function revoke_invites(guild) {
  return discord.guild_invites_list(guild.id)
    .then(invites => invites.map(invite => discord.invite_delete(invite.code).then(() => invite))) // TODO we can check how often it was used maybe and who created it? or what role
    .then(promises => Promise.all(promises));
}

async function kick_and_ban_suspects(guild) {
  return discord.guild_members_list(guild.id)
    .then(members => members.filter(member => new Date(member.joined_at) > new Date(Date.now() - 1000 * GUILD_MEMBER_SUSPECT_TIMEFRAME)))
    .then(suspects => suspects.map(suspect => kick_and_ban_user(guild.id, member.user.id).then(() => suspect)))
    .then(promises => Promise.all(promises));
}

async function kick_and_ban_user(guild_id, user_id) {
  return discord.guild_member_kick(guild_id, user_id).then(() => discord.guild_ban_create(guild_id, user_id, 'suspect about contribution to a raid'));
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

// goal of these numbers is to make sure its a machine, not a real human
const GUILD_MESSAGE_SCAM_TIMEFRAME = 1000; // rate limit resets as low as once a second
const GUILD_MESSAGE_SCAM_COUNT = 5; // default rate limit is as low as 5

async function on_guild_message_create_for_scam_protection(guild_id, channel_id, message_id) {
  let message = await discord.message_retrieve(channel_id, message_id).catch(_ => null);
  if (!message) return; // this can happen ebcause we handle one message at a time, and we may have deleted some already that we still get events for
  if (message.content == '') return;
  let channel_ids = await discord.guild_channels_list(guild_id).then(channels => channels.map(channel => channel.id));
  let count = 0;
  let suspect_messages = [];
  for (let channel_id of channel_ids) {
    let messages = await discord.messages(channel_id);
    messages = messages.filter(other_message => other_message.author.id == message.author.id);
    messages = messages.filter(other_message => new Date(other_message.timestamp).getTime() > new Date(message.timestamp).getTime() - GUILD_MESSAGE_SCAM_TIMEFRAME);
    messages = messages.filter(other_message => other_message.content == message.content);
    suspect_messages = suspect_messages.concat(messages);
  }
  if (count < GUILD_MESSAGE_SCAM_COUNT) return;
  return Promise.all([
    notify_scam(guild_id),
    quarantine_messages(suspect_messages),
    kick_and_ban_user(guild_id, message.author.id)
  ]).then(() => notify_scam_contained(guild_id, messages));
}

async function notify_scam(guild_id) {
  let guild = await discord.guild_retrieve(guild_id);
  return notify_moderators(guild_id, `**ATTENTION**: There is a **suspected scam** going on in server **${guild.name}**. I'm taking automatic action to protect the server and its members.`);
}

async function quarantine_messages(messages) {
  return Promise.all(messages.map(message => discord.message_delete(message.channel_id, message.id)))
}

async function notify_scam_contained(guild_id, quarantined_messages) {
  let example = quarantined_messages[0];
  return notify_moderators(guild_id, 'I have **contained** the **suspected scam**. I have quarantined ' + quarantine_messages.length + ' messages.'
    + ' The user ' + discord.mention_user(example.author.id) + ' has been kicked and banned because they were sending similar messages faster than a human could.'
    + ' That means, most likely, the persons account has been hacked. Before inviting the person back, please make sure they have taken back control over their account.' 
    + ' The following is an example message that has been quarantined. Do not click any links!'
    + '\n'
    + example.author.username + '#' + example.author.discriminator + ': ' + example.content
  );
}

async function notify_moderators(guild_id, text) {
  return list_moderators(guild_id).then(mods => mods.map(mod => discord.try_dms(mod.user.id, text))).then(promises => Promise.all(promises))
    .catch(_ => discord.guild_retrieve(guild_id).then(guild => guild.system_channel_id ?? Promise.reject(new Error('No system channel!'))).then(channel_id => discord.post(channel_id, text)))
    .catch(_ => discord.guild_channels_list(guild_id).then(channels => Promise.all(channels.map(channel => discord.post(channel.id, text)))))
    .catch(_ => Promise.resolve());
}

async function list_moderators(guild_id) {
  return discord.guild_members_list_with_any_permission(guild_id, [ 'ADMINISTRATOR', 'MANAGE_SERVER', 'MANAGE_ROLES', 'MANAGE_CHANNELS', 'MODERATE_MEMBERS', 'KICK_MEMBERS', 'BAN_MEMBERS' ]);
}

module.exports = { lockdown, all_clear, on_guild_member_add, on_guild_message_create }
