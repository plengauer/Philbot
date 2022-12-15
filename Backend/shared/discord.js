const permissions = require('./permissions.js');

function parse_mention(mention) {
  mention = mention.trim();
  if (!mention.startsWith('<@') || !mention.endsWith('>')) return null;
  return mention.substring(2, mention.length - 1);
}

async function me() {
  return HTTP(`/users/@me`, 'GET');
}

async function guild_retrieve(guild_id) {
  return HTTP(`/guilds/${guild_id}`, 'GET');
}

async function guilds_list() {
  return HTTP(`/users/@me/guilds`, 'GET');
}

async function guild_members_list(guild_id, role = undefined) {
  let limit = 100;
  let members = await guild_members_list_paged(guild_id, limit, undefined);
  if (members.length == limit) {
    let last = members[members.length - 1].user.id;
    let again = true;
    while (again) {
      let more = await guild_members_list_paged(guild_id, limit, last);
      if (more.length == 0) break;
      members = members.concat(more);
      last = more[more.length - 1].user.id;
      again = more.length == limit;
    }
  }
  return members.filter(member => !role || member.roles.includes(role));
}

async function guild_members_list_paged(guild_id, limit, last) {
  return HTTP(`/guilds/${guild_id}/members?limit=${limit}&after=${last}`, 'GET');
}

async function guild_member_retrieve(guild_id, user_id) {
  return HTTP(`/guilds/${guild_id}/members/${user_id}`, 'GET');
}

async function guild_roles_list(guild_id) {
  return HTTP(`/guilds/${guild_id}/roles`, 'GET');
}

async function users_list(get_role_async) {
  return guilds_list()
    .then(guilds => guilds.map(guild => (get_role_async ? get_role_async(guild.id) : Promise.resolve(null)).then(role => guild_members_list(guild.id, role))))
    .then(results => Promise.all(results))
    .then(lists => lists.flatMap(list => list).map(member => member.user))
    .then(users => {
      let cache = new Set();
      let result = [];
      for (let user of users) {
        if (cache.has(user.id)) continue;
        cache.add(user.id);
        result.push(user);
      }
      return result;
    });
}

async function voice_track_play(guild_id, voice_channel_id, download_info) {
  throw new Error('NOT IMPLEMENTED!);
}

async function scheduledevents_list(guild_id) {
  return HTTP(`/guilds/${guild_id}/scheduled-events?with_user_count=false`, 'GET');
}

async function respond(channel_id, event_id, content, tts = false) {
  let limit = 2000;
  while (content.length > limit) {
    let index = getSplitIndex(content, limit);
    await respond_paged(channel_id, event_id, content.substring(0, index), tts);
    content = content.substring(index + (index < content.length && content[index] === '\n' ? 1 : 0), content.length);
  }
  return respond_paged(channel_id, event_id, content, tts);
}

async function respond_paged(channel_id, event_id, content, tts) {
  return HTTP(`/channels/${channel_id}/messages`, 'POST', {
      content: content,
      tts: tts,
      message_reference: { message_id: event_id, fail_if_not_exists: false }
      flags: 1 << 2 // SUPPRESS_EMBEDS
    });
}

function getSplitIndex(string, limit) {
  let index = string.substring(0, limit).lastIndexOf('\n\n');
  if (index <= 0) index = string.substring(0, limit).lastIndexOf('\n');
  if (index <= 0) index = string.substring(0, limit - 1).lastIndexOf('.') + 1;
  if (index <= 0) index = string.substring(0, limit - 1).lastIndexOf(',') + 1;
  if (index <= 0) index = string.substring(0, limit - 1).lastIndexOf(' ') + 1;
  if (index <= 0) index = limit;
  return index;
}

async function post(channel_id, content, tts = false) {
  return respond(channel_id, undefined, content, tts);
}

async function dms(user_id, content) {
  let limit = 2000;
  while (content.length > limit) {
    let index = getSplitIndex(content, limit);
    await dms_paged(user_id, content.substring(0, index));
    content = content.substring(index + (index < content.length && content[index] === '\n' ? 1 : 0), content.length);
  }
  return dms_paged(user_id, content);
}

async function dms_paged(user_id, content) {
  return HTTP(`/users/@me/channels`, 'POST', { recipient_id: user_id })
    .then(dm_channel => post(dm_channel.id, content);
}

async function try_dms(user_id, content) {
  return dms(user_id, content)
    .then(() => true)
    .catch(ex => {
      if (ex.stack.includes('Cannot send messages to this user: code 50007')) return false;
      throw ex;
    });
}

async function guild_members_list_with_permission(guild_id, permission) {
  return guild_members_list_with_any_permission(guild_id, [ permission ]);
}

async function guild_members_list_with_any_permission(guild_id, permissions) {
  return Promise.all([ guild_retrieve(guild_id), guild_members_list(guild_id), guild_roles_list(guild_id) ])
    .then(data => data[1].filter(member => permissions.some(permission => guild_member_has_permission_0(data[0], data[2], member, permission))));
}

async function guild_member_has_permission(guild_id, user_id, permission) {
  return Promise.all([ guild_retrieve(guild_id), guild_roles_list(guild_id), guild_member_retrieve(guild_id, user_id) ])
    .then(data => guild_member_has_permission_0(data[0], data[1], data[2], permission));
}

function guild_member_has_permission_0(guild, roles, member, permission) {
  return guild.owner_id == member.user.id || roles
    .filter(role => member.roles.includes(role.id))
    .map(role => permissions.decompile(role.permissions))
    .some(permission_names => permission_names.includes(permission) || permission_names.includes('ADMINISTRATOR'))
}

async function HTTP(endpoint, method, payload = undefined) {
  return curl.do(method, 'discord.com', '/api/v10' + endpoint, { 'accept': 'application/json', 'content-type': 'application/json', 'authorization': 'Bot ' + process.env.DISCORD_TOKEN }, payload); //TODO would this just like parsing also take care of serializing?
}

module.exports = { parse_mention, guild_retrieve, guilds_list, guild_members_list, guild_member_retrieve, guild_roles_list, users_list, voice_track_play, scheduledevents_list, post, respond, dms, try_dms, guild_member_has_permission, guild_members_list_with_permission, guild_members_list_with_any_permission }
