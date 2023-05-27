const url = require('url')
const process = require('process');
const permissions = require('./permissions.js');
const curl = require('./curl.js');
const { retry } = require('./retry.js');
let FormData = require('form-data');

var callbacks = {};

function register_callback(guild_id, url) {
  callbacks[guild_id] = url;
}

function parse_mention(mention) {
  mention = mention.trim();
  if (!mention.startsWith('<@') || !mention.endsWith('>')) return null;
  return mention.substring(2, mention.length - 1);
}

function parse_role(mention) {
  mention = mention.trim();
  if (!mention.startsWith('<@&') || !mention.endsWith('>')) return null;
  return mention.substring(3, mention.length - 1);
}

function mention_user(user_id) {
  return `<@${user_id}>`;
}

function mention_role(role_id) {
  return `<@&${role_id}>`;
}

function message_link_create(guild_id, channel_id, message_id) {
  return `https://discord.com/channels/${guild_id}/${channel_id}/${message_id}`;
}

function scheduledevent_link_create(guild_id, event_id) {
  return `https://discord.com/events/${guild_id}/${event_id}`;
}

async function me() {
  return HTTP(`/users/@me`, 'GET', undefined, 60 * 60);
}

async function user_retrieve(user_id) {
  return HTTP(`/users/${user_id}`, 'GET');
}

async function guild_retrieve(guild_id) {
  return HTTP(`/guilds/${guild_id}`, 'GET');
}

async function guild_create(name) {
  return HTTP(`/guilds`, 'POST', { name: name });
}

async function guild_destroy(guild_id) {
  return HTTP(`/guilds/${guild_id}`, 'DELETE');
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
  return HTTP(`/guilds/${guild_id}/members?limit=${limit}` + (last ? `&after=${last}` : ''), 'GET');
}

async function guild_member_retrieve(guild_id, user_id) {
  return HTTP(`/guilds/${guild_id}/members/${user_id}`, 'GET');
}

async function guild_member_kick(guild_id, user_id) {
  return HTTP(`/guilds/${guild_id}/members/${user_id}`, 'DELETE');
}

async function guild_member_move(guild_id, user_id, channel_id) {
  return HTTP(`/guilds/${guild_id}/members/${user_id}`, 'PATCH', {
      channel_id: channel_id
    });
}

async function guild_member_has_role(guild_id, user_id, role_id) {
  return guild_id == role_id || guild_member_retrieve(guild_id, user_id).then(member => member.roles.includes(role_id));
}

async function guild_member_role_assign(guild_id, user_id, role_id) {
  return HTTP(`/guilds/${guild_id}/members/${user_id}/roles/${role_id}`, 'PUT');
}

async function guild_member_role_unassign(guild_id, user_id, role_id) {
  return HTTP(`/guilds/${guild_id}/members/${user_id}/roles/${role_id}`, 'DELETE');
}

async function guild_member_nick_update(guild_id, user_id, nick) {
  return HTTP(`/guilds/${guild_id}/members/${user_id}`, 'PATCH', { nick: nick });
}

async function guild_roles_list(guild_id) {
  return HTTP(`/guilds/${guild_id}/roles`, 'GET');
}

async function guild_role_retrieve(guild_id, role_id) {
  return guild_roles_list(guild_id)
    .then(roles => roles.find(role => role.id == role_id))
    .then(role => new Promise((resolve, reject) => role ? resolve(role) : reject(new Error())));
}

async function guild_role_create(guild_id, name, permissions = undefined, hoist = false, mentionable = true, color = undefined) {
  return HTTP(`/guilds/${guild_id}/roles`, 'POST', {
      name: name,
      permissions: permissions,
      hoist: hoist,
      mentionable: mentionable,
      color: color
    });
}

async function guild_role_modify(guild_id, role_id, name, permissions = undefined, hoist = undefined, mentionable = undefined, color = undefined) {
  return HTTP(`/guilds/${guild_id}/roles/${role_id}`, 'PATCH', {
      name: name,
      permissions: permissions,
      hoist: hoist,
      mentionable: mentionable,
      color: undefined
    });
}

async function guild_role_delete(guild_id, role_id) {
  return HTTP(`/guilds/${guild_id}/roles/${role_id}`, 'DELETE');
}

async function guild_channels_list(guild_id) {
  return HTTP(`/guilds/${guild_id}/channels`, 'GET');
}

async function guild_channel_create(guild_id, name, category, type) {
  return HTTP(`/guilds/${guild_id}/channels`, 'POST', {
      name: name,
      parent_id: category,
      type: type,
    });
}

async function guild_channel_delete(guild_id, channel_id) {
  return HTTP(`/channels/${channel_id}`, 'DELETE');
}

async function guild_channel_rename(guild_id, channel_id, name) {
  return HTTP(`/channels/${channel_id}`, 'PATCH', { name: name });
}

async function guild_channel_permission_overwrite(channel_id, role_id, allow, deny) {
  return HTTP(`/channels/${channel_id}/permissions/${role_id}`, 'PUT', {
      allow: allow,
      deny: deny,
      type: 0 /* role */
    });
}

async function guild_invites_list(guild_id) {
  return HTTP(`/guilds/${guild_id}/invites`, 'GET');
}

async function guild_ban_create(guild_id, user_id, reason) {
  return HTTP(`/guilds/${guild_id}/bans/${user_id}`, 'PUT');
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

async function user_retrieve(user_id) {
  return HTTP(`/users/${user_id}`, 'GET');
}

async function scheduledevents_list(guild_id) {
  return HTTP(`/guilds/${guild_id}/scheduled-events?with_user_count=false`, 'GET');
}

async function scheduledevent_create(guild_id, channel_id, name, description, scheduled_start_time) {
  return HTTP(`/guilds/${guild_id}/scheduled-events`, 'POST', {
      channel_id: channel_id,
      name: name,
      description: description,
      scheduled_start_time: scheduled_start_time.toISOString(),
      scheduled_end_time: channel_id ? undefined : new Date(scheduled_start_time + 1000 * 60 * 60).toISOString(),
      privacy_level: 2 /* GUILD_ONLY */,
      entity_type: channel_id ? 2 : 3
    }); 
}

async function scheduledevent_update_status(guild_id, event_id, status) {
  return HTTP(`/guilds/${guild_id}/scheduled-events/${event_id}`, 'PATCH', { status: status }); 
}

async function scheduledevent_update_location(guild_id, event_id, channel_id) {
  return HTTP(`/guilds/${guild_id}/scheduled-events/${event_id}`, 'PATCH', { entity_type: 2, channel_id: channel_id, scheduled_end_time: null }); 
}

async function scheduledevent_users_list(guild_id, event_id) {
  const limit = 100;
  let users = [];
  for (;;) {
    let users_chunk = await HTTP(`/guilds/${guild_id}/scheduled-events/${event_id}/users?limit=${limit}` + (users.length > 0 ? '&after=' + users[users.length - 1].id : ''), 'GET').then(result => result.map(result.user));
    users = users.concat(users_chunk);
    if (users_chunks.length < limit) break;
  }
  return users;
}

async function invite_create(channel_id) {
  return HTTP(`/channels/${channel_id}/invites`, 'POST', { max_age: 0, max_uses: 1 });
}

async function invite_delete(invite_code)  {
  return HTTP(`/invites/${invite_code}`, 'DELETE');
}

async function messages(channel_id) {
  return HTTP(`/channels/${channel_id}/messages`, 'GET');
}

async function message_retrieve(channel_id, message_id) {
  return HTTP(`/channels/${channel_id}/messages/${message_id}`, 'GET'); 
}

async function message_update(channel_id, message_id, content, embeds = [], components = []) {
  return HTTP(`/channels/${channel_id}/messages/${message_id}`, 'PATCH', { content: content, embeds: embeds, components: components }); 
}

async function message_delete(channel_id, message_id) {
  return HTTP(`/channels/${channel_id}/messages/${message_id}`, 'DELETE'); 
}

async function respond(channel_id, event_id, content, notify = true) {
  return post(channel_id, content, event_id, notify);
}

async function dms(user_id, content) {
  return dms_channel_retrieve(user_id).then(dm_channel => post(dm_channel.id, content));
}

async function dms_channel_retrieve(user_id) {
  return HTTP(`/users/@me/channels`, 'POST', { recipient_id: user_id });
}

async function try_dms(user_id, content) {
  return dms(user_id, content)
    .then(() => true)
    .catch(ex => {
      if (ex.stack.includes('Cannot send messages to this user')) return false;
      throw ex;
    });
}

async function trigger_typing_indicator(channel_id) {
  return HTTP(`/channels/${channel_id}/typing`, 'POST');
}

async function post(channel_id, content, referenced_message_id = undefined, notify = true, embeds = [], components = [], attachments = []) {
  let limit = 2000;
  while (content.length > limit) {
    let index = getSplitIndex(content, limit);
    await post_paged(channel_id, content.substring(0, index).trim(), referenced_message_id, notify, [], [], []);
    content = content.substring(index + (index < content.length && content[index] === '\n' ? 1 : 0), content.length);
  }
  return post_paged(channel_id, content, referenced_message_id, notify, embeds, components, attachments);
}

async function post_paged(channel_id, content, referenced_message_id, notify, embeds, components, attachments) {
  let endpoint = `/channels/${channel_id}/messages`;
  let method = 'POST';
  let payload = {
    content: content,
    message_reference: referenced_message_id ? { message_id: referenced_message_id } : undefined,
    flags: (embeds.length == 0 && ((content.includes('https://discord.com/') || ((content.match(/http:\/\//g) ?? []).length + (content.match(/https:\/\//g) ?? []).length) > 1)) ? 1 << 2 /* SUPPRESS_EMBEDS */ : 0)
      | (notify ? 0 : (1 << 12 /* SUPPRESS_NOTIFICATIONS */)),
    embeds: embeds,
    components: components,
  };
  if (attachments.length > 0) {
    let formdata = new FormData();
    formdata.append('payload_json', JSON.stringify(payload), { contentType: 'application/json' });
    for (let index = 0; index < attachments.length; index++) {
      let attachment = attachments[index];
      formdata.append(`file[${index}]`, attachment.content, { contentType: attachment.content_type, filename: attachment.filename });
    }
    let headers = formdata.getHeaders();
    headers['authorization'] = `Bot ${process.env.DISCORD_API_TOKEN}`;
    return curl.request({ method: method, hostname: 'discord.com', path: `/api/v10${endpoint}`, body: formdata, headers: headers });
  } else {
    return HTTP(endpoint, method, payload);
  }
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

async function reactions_list(channel_id, message_id, emoji) {
  let limit = 100;
  let list = [];
  while (true) {
    let page = await reactions_list_paged(channel_id, message_id, emoji, limit, list.length > 0 ? list[list.length - 1] : undefined);
    list = list.concat(page);
    if (page.length < limit) break;
  }
  return list;
}

async function reactions_list_paged(channel_id, message_id, emoji, limit, after = undefined) {
  let encoded_emoji = encodeURIComponent(emoji);
  try {
    return await HTTP(`/channels/${channel_id}/messages/${message_id}/reactions/${encoded_emoji}?limit=${limit}` + (after ? 'after=' + after : ''), 'GET')
  } catch (error) {
    if (error.message.toLowerCase().includes('unknown emoji')) return [];
    else throw error;
  }
}

async function reaction_create(channel_id, message_id, emoji) {
  let encoded_emoji = encodeURIComponent(emoji);
  return HTTP(`/channels/${channel_id}/messages/${message_id}/reactions/${encoded_emoji}/@me`, 'PUT');
}

async function interact(interaction_id, interaction_token, response = { type: 6 }) {
  return HTTP(`/interactions/${interaction_id}/${interaction_token}/callback`, 'POST', response);
}

async function connect(guild_id, channel_id) {
  return GATEWAY_HTTP('/voice_state_update', 'POST', guild_id, { guild_id: guild_id, channel_id: channel_id });
}

async function disconnect(guild_id) {
  return GATEWAY_HTTP('/voice_state_update', 'POST', guild_id, { guild_id: guild_id, channel_id: null });
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
    .some(permission_names => permission_names.includes(permission) || permission_names.includes('ADMINISTRATOR'));
}

async function HTTP(endpoint, method, payload = undefined, ttc = undefined) {
  return curl.request({ method: method, hostname: 'discord.com', path: `/api/v10${endpoint}`, body: payload, headers: { 'authorization': `Bot ${process.env.DISCORD_API_TOKEN}` }, cache: ttc ?? 10 });
}

async function GATEWAY_HTTP(endpoint, method, guild_id, payload = undefined, ttc = undefined) {
  let callback_url = await retry(() => callbacks[guild_id] ?? Promise.reject('No callback gateway known'));
  return curl.request({ secure: false, method: method, hostname: url.parse(callback_url).hostname, port: url.parse(callback_url).port, path: endpoint, headers: { 'x-authorization': process.env.DISCORD_API_TOKEN }, body: payload, cache: ttc ?? 10 });
}

module.exports = {
  register_callback,

  parse_mention,
  parse_role,
  mention_user,
  mention_role,

  message_link_create,
  scheduledevent_link_create,
  
  me,
  user_retrieve,

  guilds_list,
  guild_retrieve,
  guild_create,
  guild_destroy,
  
  guild_members_list,
  guild_member_retrieve,
  guild_member_kick,
  guild_member_move,
  guild_member_has_role,
  guild_member_role_assign,
  guild_member_role_unassign,
  guild_member_nick_update,
  
  guild_roles_list,
  guild_role_retrieve,
  guild_role_create,
  guild_role_modify,
  guild_role_delete,
  
  guild_channels_list,
  guild_channel_create,
  guild_channel_delete,
  guild_channel_rename,
  guild_channel_permission_overwrite,

  guild_invites_list,

  guild_ban_create,
  
  users_list,
  user_retrieve,
  
  scheduledevents_list,
  scheduledevent_create,
  scheduledevent_update_status,
  scheduledevent_update_location,
  scheduledevent_users_list,

  invite_create,
  invite_delete,
  
  message_retrieve,
  message_update,
  message_delete,
  messages,

  trigger_typing_indicator,
  post,
  respond,
  dms,
  try_dms,
  dms_channel_retrieve,
  
  reactions_list,
  reaction_create,
  react: async function(channel_id, message_id, emoji) { return reaction_create(channel_id, message_id, emoji); }, // backwards compatibility

  interact,

  connect,
  disconnect,
  
  guild_member_has_permission,
  guild_members_list_with_permission,
  guild_members_list_with_any_permission
}
