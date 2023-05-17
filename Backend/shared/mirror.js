const url = require('url')
const memory = require('./memory.js');
const discord = require('./discord.js');
const curl = require('./curl.js');

function memorykey(guild_id) {
  return `mirrors:guild:${guild_id}`;
}

async function configure_mirror(guild_id, user_id, input_mirror_guild_id = undefined) {
  // resolve the right guild and validate
  let original = await discord.guild_retrieve(guild_id);
  let mirror = null;
  if (input_mirror_guild_id) {
    mirror = await discord.guild_retrieve(input_mirror_guild_id);
    let members = await discord.guild_members_list(mirror.id);
    let me = await discord.me();
    if (!members.every(member => member.user.id == user_id || member.user.id == me.id)) throw new Error();
    if (members.length != 2) throw new Error();
    if (!discord.guild_member_has_permission(mirror.id, me.id, 'ADMINISTRATOR')) throw new Error();
  } else {
    mirror = await discord.guild_create(`${original.name} Mirror`);
  }

  mirror_info = { guild_id: mirror.id, source_guild_id: guild_id, user_id: user_id, channel_ids: {} };
  try {
    // clean and prepare the guild
    for (let channel of await discord.guild_channels_list(mirror_info.guild_id)) {
      await discord.guild_channel_delete(mirror_info.guild_id, channel.id);
    }
    for (let role of await discord.guild_roles_list(mirror_info.guild_id)) {
      if (role.id == mirror_info.guild_id) continue;
      await discord.guild_role_delete(mirror_info.guild_id, role.id).catch(() => {});
    }
    for (let channel of await discord.guild_channels_list(guild_id).then(channels => channels.sort((a, b) => a.position - b.position))) {
      if (channel.type == 5 || channel.type == 10 || channel.type == 15) channel.type = 0;
      if (channel.type == 13) channel.type = 2;
      let mirrored_channel = await discord.guild_channel_create(mirror_info.guild_id, channel.name, channel.parent_id ? mirror_info.channel_ids[channel.parent_id] : undefined, channel.type);
      mirror_info.channel_ids[channel.id] = mirrored_channel.id;
    }
    await memory.set(memorykey(guild_id), (await memory.get(memorykey(guild_id), [])).concat([mirror_info]));
    
    // report
    if (input_mirror_guild_id) {
      await discord.dms(user_id, `The mirror has been initialized.`);
    } else {
      let mirror_channels = await discord.guild_channels_list(mirror_info.guild_id).then(channels => channels.filter(channel => channel.type == 0));
      if (mirror_channels.length == 0) throw new Error();
      let invite = await discord.invite_create(mirror_channels[0].id);
      let link = `https://discord.gg/${invite.code}`;
      await discord.dms(user_id, `A mirror of ${original.name} has been created! Join with this link: ${link}`);
    }
  } catch (e) {
    await memory.set(memorykey(guild_id), (await memory.get(memorykey(guild_id), [])).filter(other_mirror_info => other_mirror_info.guild_id != mirror_info.guild_id));
    if (!input_mirror_guild_id) await discord.guild_destroy(mirror_info.guild_id);
    throw e;
  }
}

async function on_message_create(guild_id, channel_id, user_id, message_id, content, referenced_message_id, attachments, embeds, components) {
  let mirrors = await memory.get(memorykey(guild_id), []);
  return Promise.all(mirrors.map(mirror_info => forward_message(guild_id, channel_id, user_id, message_id, content, referenced_message_id, attachments, embeds, components, mirror_info)))
    .finally(() => memory.set(memorykey(guild_id), mirrors));
}

async function forward_message(guild_id, channel_id, user_id, message_id, content, referenced_message_id, attachments, embeds, components, mirror_info) {
  // resolving the channel / making sure the channel exists
  if (!mirror_info.channel_ids[channel_id]) {
    let original = await discord.guild_channels_list(guild_id).then(channels => channels.find(channel => channel.id == channel_id));
    let mirrored_channel = await discord.guild_channel_create(mirror_info.guild_id, original.name, original.parent_id ? mirror_info.channel_ids[original.parent_id] : undefined, original.type);
    mirror_info.channel_ids[channel_id] = mirrored_channel.id;
  }

  // build the content
  let author = await discord.guild_member_retrieve(guild_id, user_id).then(member => member2string(member)).catch(() => '<UnknownUser>');
  while (content.includes('<@&')) {
    let start = content.indexOf('<@&');
    let end = content.indexOf('>', start) + 1;
    let mentioned_role_id = discord.parse_role(content.substring(start, end));
    let mentioned_role = await discord.guild_role_retrieve(guild_id, mentioned_role_id).then(role => role.name);
    content = content.replace(content.substring(start, end), '@' + mentioned_role);
  }
  while (content.includes('<@')) {
    let start = content.indexOf('<@');
    let end = content.indexOf('>', start) + 1;
    let mentioned_user_id = discord.parse_mention(content.substring(start, end));
    let mentioned_member = await discord.guild_member_retrieve(guild_id, mentioned_user_id).then(member => member2string(member)).catch(() => '<UnknownUser>');
    content = content.replace(content.substring(start, end), '@' + mentioned_member);
  }
  content = `**${author}**: ${content}`;

  // resolve a referenced message
  let referenced_message_id_mirror = referenced_message_id ? await memory.get(`mirror:message:${referenced_message_id}`) : undefined;
  
  // build the embeds
  // nothing to do, just reuse them
  
  // build components
  disarm_components(components); // disarm and reuse
  
  // build attachments
  let attachment_mirrors = [];
  for (let index = 0; index < attachments.length; index++) {
    let attachment = attachments[index];
    try {
      if (attachment.size > 1024 * 1024 * 25) throw new Error('maybe too big');
      let uri = url.parse(attachment.url);
      let file = Buffer.from(await curl.request({ hostname: uri.hostname, path: uri.path + uri.search }));
      attachment_mirrors.push({ filename: attachment.filename, content_type: attachment.content_type, content: file });
    } catch {
      content += '\n**Attachment ' + index + '**: ' + attachment.url;
    }
  }

  let message = await discord.post(mirror_info.channel_ids[channel_id], content, referenced_message_id_mirror, true, embeds, components, attachment_mirrors);
  await memory.set(`mirror:message:${message_id}`, message.id, 60 * 60 * 24 * 3);
}

function disarm_components(components) {
  for (let component of components) {
    if (component.type == 1) {
      disarm_components(component.components);
    } else if (component.custom_id) {
      component.custom_id = 'interaction.noop';
    }
  }
}

function member2string(member) {
  let string = `${member.user.username}#${member.user.discriminator}`;
  if (member.nick) string = `${member.nick} (${string})`;
  return string;
}

async function clean() {
  let me = await discord.me();
  let guilds = await discord.guilds_list();
  for (let mirrors of await memory.list().then(entries => entries.filter(entry => entry.key.startsWith('mirrors:guild:')))) {
    let guild_ids_to_destroy = [];
    for (let mirror of mirrors.value) {
      let members = await discord.guild_members_list(mirror.guild_id);
      if (members.length == 1 && members.every(member => member.user.id == me.id)) await guild_ids_to_destroy.push(mirror.guild_id);
      else if (!guilds.some(guild => guild.id == mirror.source_guild_id)) {
        for (let channel of await discord.guild_channels_list(mirror.guild_id)) {
          await discord.post(channel.id, 'I do not have access to the server any longer. Either the server was deleted or I was kicked.').catch(() => {});
        }
      } else {
        let channels = await discord.guild_channels_list(mirror.source_guild_id).then(channels => channels.sort((a, b) => a.position - b.position));
        for (let channel of channels) {
          if (mirror.channel_ids[channel.id]) {
            let mirrored_channel = await discord.guild_channels_list(mirror.guild_id).then(channels => channels.find(c => c.id == mirror.channel_ids[channel.id]));
            if (channel.name != mirrored_channel.name) {
              await discord.post(mirrored_channel.id, 'The channel has been renamed to **' + channel.name + '**.').catch(() => {});
              await discord.guild_channel_rename(mirror.guild_id, mirrored_channel.id, channel.name);
            }
          } else {
            let mirrored_channel = await discord.guild_channel_create(mirror_info.guild_id, channel.name, channel.parent_id ? mirror_info.channel_ids[channel.parent_id] : undefined, channel.type);
            mirror_info.channel_ids[channel.id] = mirrored_channel.id;  
          }
        }
        for (let channel_id in mirror.channel_ids) {
          if (channels.some(channel => channel.id == channel_id)) continue;
          await discord.post(mirror.channel_ids[channel_id], 'I do not have access to this channel any longer. Either it was deleted or my permissions to view it have been revoked.').catch(() => {});
          delete mirror.channel_ids[channel_id];
        }
      }
    }
    await Promise.all(guild_ids_to_destroy.map(guild_id => discord.guild_destroy(guild_id))).catch(() => {});
    await memory.set(mirrors.key, mirrors.value.filter(mirror => !guild_ids_to_destroy.includes(mirror.guild_id)));
  }
}

//TODO special section for channels about server members joining and leaving. voice state changes in the servers, about role changes and name changes
//TODO reactions?

module.exports = { configure_mirror, on_message_create, clean }
