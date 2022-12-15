const permissions = require('./permissions.js');

function parse_mention(mention) {
  mention = mention.trim();
  if (!mention.startsWith('<@') || !mention.endsWith('>')) return null;
  return mention.substring(2, mention.length - 1);
}

async function guild_retrieve(guild_id) {
  return lib.discord.guilds['@0.2.4'].retrieve({ guild_id: guild_id });
}

async function guilds_list() {
  let limit = 100;
  let guilds = await guilds_list_paged(limit, undefined, undefined);
  if (guilds.length == limit) {
    let first = guilds[0].id;
    let last = guilds[guilds.length - 1].id;
    let again = true;
    while (again) {
      let more = await guilds_list_paged(limit, first, undefined);
      guilds = more.concat(guilds);
      first = guilds[0].id;
      again = more.length == limit;
    }
    again = true;
    while (again) {
      let more = await guilds_list_paged(limit, undefined, last);
      guilds = guilds.concat(more);
      last = guilds[guilds.length - 1].id;
      again = more.length == limit;
    }
  }
  return guilds;
}

async function guilds_list_paged(limit, first, last) {
  return lib.discord.guilds['@0.2.2'].list({ limit: limit, before: first, after: last });
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
  return lib.discord.guilds['@0.2.2'].members.list({ guild_id: guild_id, limit: limit, after: last });
}

async function guild_member_retrieve(guild_id, user_id) {
  return lib.discord.guilds['@0.2.4'].members.retrieve({ guild_id: guild_id, user_id: user_id });
}

async function guild_roles_list(guild_id) {
  return lib.discord.guilds['@0.2.4'].roles.list({ guild_id: guild_id });
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
  return lib.discord.voice['@0.0.1'].tracks.play({
      guild_id: guild_id,
      channel_id: voice_channel_id,
      download_info: download_info
    });
}

async function scheduledevents_list(guild_id) {
  return lib.discord.scheduledevents['@0.0.1'].list({ guild_id: guild_id });
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
  return lib.discord.channels['@0.2.0'].messages.create({
      channel_id: channel_id,
      content: content,
      tts: tts,
      message_reference: {
        message_id: event_id
      }
    }).then(result => remove_embeds(result.channel_id, result.id, content).then(() => result));
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

async function remove_embeds(channel_id, message_id, content) {
  if (!channel_id) return Promise.resolve();
  if (content && count(content, 'http://') + count(content, 'https://') < 2 && count(content, 'https://discord.com/events/') == 0) return Promise.resolve();
  return lib.discord.channels['@0.3.2'].messages.update({
      channel_id: channel_id,
      message_id: message_id,
      flags: 1 << 2 // SUPPRESS_EMBEDS
    }).catch(ex => { /* mimimi - just swallow */ });
}

function count(haystack, needle) {
  let count = 0;
  let index = 0;
  while (index < haystack.length) {
    let f = haystack.indexOf(needle, index);
    if (f >= 0) {
      count++;
      index = f + needle.length;
    } else {
      index = haystack.length;
    }
  }
  return count;
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
  return lib.discord.users['@0.2.0'].dms.create({
      recipient_id: user_id,
      content: content
    })
    .then(result => remove_embeds(result.channel_id, result.id, content).then(() => result));
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

module.exports = { parse_mention, guild_retrieve, guilds_list, guild_members_list, guild_member_retrieve, guild_roles_list, users_list, voice_track_play, scheduledevents_list, post, respond, dms, try_dms, guild_member_has_permission, guild_members_list_with_permission, guild_members_list_with_any_permission }
