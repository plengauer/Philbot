const process = require('process');
const fs = require('fs');
const url = require('url');
const Zip = require('jszip');
const boomer = require('boomerencoding');
const curl = require('../../../shared/curl.js');
const memory = require('../../../shared/memory.js');
const delayed_memory = require('../../../shared/delayed_memory.js');
const discord = require('../../../shared/discord.js');
const media = require('../../../shared/media.js');
const player = require('../../../shared/player.js');
const games = require('../../../shared/games/games.js');
const urban_dictionary = require('../../../shared/urban_dictionary.js');
const tournament = require('../../../shared/tournament.js');
const identity = require('../../../shared/identity.js');
const features = require('../../../shared/features.js');
const permissions = require('../../../shared/permissions.js');
const raid_protection = require('../../../shared/raid_protection.js');
const subscriptions = require('../../../shared/subscriptions.js');
const role_management = require('../../../shared/role_management.js');
const ai = require('../../../shared/ai.js');
const translator = require('../../../shared/translator.js');
const mirror = require('../../../shared/mirror.js');
const democracy = require('../../../shared/democracy.js');

async function handle(payload) {
  return handle0(payload.guild_id, payload.channel_id, payload.id, payload.author.id, payload.content, payload.referenced_message?.id, payload.attachments ?? [], payload.embeds ?? [], payload.components ?? [], payload.flags)
    .then(() => undefined);
}

async function handle0(guild_id, channel_id, event_id, user_id, message, referenced_message_id, attachments, embeds, components, flags) {
  let me = await discord.me();

  let is_voice_message = (flags & (1 << 13)) != 0;
  let is_audio = (flags & (1 << 31)) != 0;

  if (is_voice_message && await memory.consume(`voice_clone:in_progress:user:${user_id}`, false)) {
    let attachment = attachments[0];
    if (attachment.duration_secs < 60) return respond(guild_id, channel_id, event_id, 'The voice sample is too short!');
    let format = attachment.content_type.split('/')[1];
    await memory.set(`voice_clone:sample:user:${user_id}`, attachment);
    await ai.seedVoice(null, user_id, await streamAttachment(attachment), format);
    return reactOK(channel_id, event_id);
  }

  if (is_voice_message || is_audio) {
    let instructions = (await createBasicAIContext(guild_id, me)) + ' This is a transcript of a Discord ' + (is_audio ? 'conversation' : 'voice message') + '.';
    message = await transcribeAttachment(user_id, attachments[0], instructions, is_audio);
    if (is_audio && !message) return;    
    if (guild_id) {
      for (let member of await discord.guild_members_list(guild_id)) {
        for (let name of [ discord.member2name(member), discord.user2name(member.user), member.user.username ]) {
          while (message.includes(name)) message = message.replace(name, discord.mention_user(member.user.id)); //TODO this is a problem, because it replaces names that are parts of other words
        }
      }
    }
  }

  await mirror.on_message_create(guild_id, channel_id, user_id, event_id, message, referenced_message_id, attachments, embeds, components, flags);

  message = message.trim();
  if (message.length == 0) return;
  
  let mentioned = false;
  if (user_id == me.id) {
    if (message.startsWith('@self ')) {
      message = message.substring('@self '.length);
      mentioned = true
    } else
      return;
    }
  } else if (message.startsWith('@' + me.username + ' ')) {
    mentioned = true;
    message = message.substring(1 + me.username.length).trim();
  } else if (message.startsWith('@' + discord.user2name(me) + ' ')) {
    mentioned = true;
    message = message.substring(1 + discord.user2name(me).length).trim();
  } else if (message.startsWith(discord.mention_user(me.id)) || message.startsWith(`<@!${me.id}>`)) {
    mentioned = true;
    message = message.substring(message.indexOf('>') + 1).trim();
  } else if (guild_id && message.startsWith('<@&')) {
    mentioned = (await discord.guild_member_retrieve(guild_id, me.id)).roles.some(role_id => message.startsWith(discord.mention_role(role_id)));
    if (mentioned) message = message.substring(message.indexOf('>') + 1).trim();
  } else {
    mentioned = !guild_id && user_id != me.id;
  }
  if (mentioned && (is_audio || is_voice_message)) {
    if (message.startsWith(',')) message = message.substring(1);
    if (message.endsWith('.')) message = message.substring(0, message.length - 1);
    message = message.trim();
  }

  let can_respond = !guild_id || await discord.guild_member_has_all_permissions(guild_id, channel_id, me.id, permissions.required()) || process.env.DISABLE_MESSAGE_PERMISSION_CHECK == 'true';
  if (!can_respond && mentioned) {
    const key = `mute:auto:message.create.permissions:channel:${channel_id}`;
    if (!await memory.get(key, false)) {
      await memory.set(key, true, 60 * 60 * 24 * 7);
      let text = `Due to missing permissions, I'm **unable to respond** to ${discord.message_link_create(guild_id, channel_id, event_id)}.`
        + ' Make sure both my role and the channel overrides grant me at least the permissions ' + permissions.required().join(', ') + '.';
      await discord.guild_members_list_with_any_permission(guild_id, null, ['MANAGE_SERVER', 'MANAGE_ROLES'])
        .then(members => Promise.all(members.map(member => discord.try_dms(member.user.id, text))));
    }
  }
  
  return Promise.all([
    features.isActive(guild_id, 'raid protection').then(active => (guild_id && !mentioned && !is_audio && active) ? raid_protection.on_guild_message_create(guild_id, channel_id, user_id, event_id) : Promise.resolve()),
    features.isActive(guild_id, 'role management').then(active => (guild_id && !mentioned && !is_audio && active) ? role_management.on_message_create(guild_id, user_id, message) : Promise.resolve()),
    (guild_id && !mentioned && can_respond && !is_audio) ? handleMessage(guild_id, channel_id, event_id, user_id, message, mentioned) : Promise.resolve(),
    (mentioned && can_respond) ? handleCommand(guild_id, channel_id, event_id, user_id, message, referenced_message_id, attachments, embeds, me).catch(ex => respond(guild_id, channel_id, event_id, `I'm sorry, I ran into an error.`).finally(() => { throw ex; })) : Promise.resolve(),
  ]);
}

async function transcribeAttachment(user_id, attachment, transcription_instructions, try_baseline) {
  let model = await ai.getDynamicModel(await ai.getTranscriptionModels());
  const baseline_key = `transcript:baseline:user:${user_id}`;
  let content_type = attachment.content_type;
  let duration_secs = attachment.duration_secs;
  let attachment_audio = await streamAttachment(attachment);
  let baseline = (try_baseline && await ai.shouldCreate(model.vendor, ai.getDefaultDynamicModelSafety() + (1 - ai.getDefaultDynamicModelSafety()) / 2)) ? await memory.get(baseline_key) : null;
  if (baseline) {
    try {
      let baseline_audio = await streamAttachment(baseline);
      let format = content_type.split('/')[1];
      attachment_audio = media.concat_audio([{ format: baseline.content_type.split('/')[1], stream: baseline_audio }, { format: content_type.split('/')[1], stream: attachment_audio }], format);
      duration_secs += baseline.duration_secs;
      content_type = 'audio/' + format;
    } catch {
      return transcribeAttachment(user_id, attachment, transcription_instructions, false);
    }
  }
  let transcription = await ai.createTranscription(model, user_id, transcription_instructions, attachment_audio, content_type.split('/')[1], duration_secs * 1000);
  if (!transcription) transcription = "";
  if (baseline) {
    if (!transcription.startsWith(baseline.text)) return transcribeAttachment(user_id, attachment, transcription_instructions, false);
    transcription = transcription.substring(baseline.text.length).trim();
  }
  if (transcription.length == 0) return transcription;
  let tokens = transcription.split(' ');
  if (3 < attachment.duration_secs && attachment.duration_secs < 30 && 5 < tokens.length && tokens.length * 0.8 < new Set(tokens).size) {
    await memory.set(baseline_key, { text: transcription, url: attachment.url, content_type: attachment.content_type, duration_secs: attachment.duration_secs }, 60 * 60 * 24);
  }
  return transcription;
}

async function streamAttachment(attachment) {
  let uri = url.parse(attachment.url);
  return curl.request({ secure: attachment.url.startsWith('https://'), hostname: uri.hostname, port: uri.port, path: uri.pathname + (uri.search ?? ''), stream: true });  
}

async function handleMessage(guild_id, channel_id, event_id, user_id, message) {
  return Promise.all([
    translator.on_message_create(guild_id, channel_id, event_id, user_id, message),
    handleMessageForTriggers(guild_id, channel_id, event_id, message),
    handleMessageForSpecificActivityMentions(guild_id, channel_id, event_id, user_id, message),
    handleMessageForGenericActivityMentions(guild_id, channel_id, event_id, user_id, message),
    handleMessageForSOSMentions(guild_id, channel_id, event_id, user_id, message),
    Math.random() < 0.1 && message.toLowerCase().includes('joke') ? curl.request({ hostname: 'icanhazdadjoke.com', headers: {'accept': 'text/plain'} }).then(result => respond(guild_id, channel_id, event_id, 'Did somebody say \'joke\'? I know a good one: ' + result)) : Promise.resolve(),
    Math.random() < 0.5 && message.toLowerCase().includes('chuck norris') ? curl.request({ hostname: 'api.chucknorris.io', path: '/jokes/random', headers: {'accept': 'text/plain'} }).then(result => respond(guild_id, channel_id, event_id, result)) : Promise.resolve(),
    Math.random() < 0.5 && message.toLowerCase().includes('ron swanson') ? curl.request({ hostname: 'ron-swanson-quotes.herokuapp.com', path: '/v2/quotes' }).then(result => respond(guild_id, channel_id, event_id, result[0])) : Promise.resolve(),
    handleMessageForFunReplies(guild_id, channel_id, event_id, user_id, message),
  ]);
}

async function handleMessageForSpecificActivityMentions(guild_id, channel_id, event_id, user_id, message) {
  if(!message.includes('@') || !message.split('').some((char, index) => char == '@' && (index == 0 || message.charAt(index-1) != '<'))) return;
  let activities = [];
  for (let index = 0; index < message.length; index++) {
    if (message.charAt(index) != '@' || (index > 0 && message.charAt(index-1) == '<')) continue;
    let f = index + 1;
    for (let t = f + 1; t <= message.length; t++) {
      activities.push(message.substring(f, t));
    }
  }
  let user_ids = await resolveMembersForSpecialActivityMentions(guild_id, channel_id, user_id, message, activities);
  if (user_ids.length == 0) return;
  return respond(guild_id, channel_id, event_id, 'Fyi ' + user_ids.map(discord.mention_user).join(', '));
}

async function handleMessageForGenericActivityMentions(guild_id, channel_id, event_id, user_id, message) {
  if (!message.includes('@activity')) return;
  let activities = await memory.get(`activities:current:user:${user_id}`, []);
  if (activities.length == 0) return;
  let user_ids = await resolveMembersForSpecialActivityMentions(guild_id, channel_id, user_id, message, activities);
  if (user_ids.length == 0) return;
  return respond(guild_id, channel_id, event_id, 'Fyi ' + user_ids.map(discord.mention_user).join(', '));
}

async function handleMessageForSOSMentions(guild_id, channel_id, event_id, user_id, message) {
  if (!message.toUpperCase().includes('SOS') && !message.toUpperCase().includes('S.O.S')) return;
  let activities = await memory.get(`activities:current:user:${user_id}`, []);
  if (activities.length == 0) return;
  let user_ids = await resolveMembersForSpecialActivityMentions(guild_id, channel_id, user_id, message, activities);
  if (user_ids.length == 0) return;
  return respond(guild_id, channel_id, event_id, `**SOS** by ${discord.mention_user(user_id)} for ` + activities.join(',') + ` ` + user_ids.map(discord.mention_user).join(', '));
}

async function resolveMembersForSpecialActivityMentions(guild_id, channel_id, user_id, message, activities) {
  let members = await discord.guild_members_list(guild_id);
  let user_ids = members.map(member => member.user.id).filter(other_user_id => user_id !== other_user_id && !message.includes(other_user_id));
  user_ids = await Promise.all(user_ids.map(other_user_id => memory.get(`activities:all:user:${other_user_id }`, [])
    .then(other_activities => {
      for (let activity of activities) {
        if (other_activities.includes(activity)) {
          return memory.list([
            `mute:activity:${activity}`,
            `mute:user:${other_user_id}`,
            `mute:user:${other_user_id}:activity:${activity}`,
            `mute:user:${other_user_id}:other:${user_id}`
          ]).then(values => !values.reduce((b1, b2) => b1 || b2, false))
        }
      }
      return false;
    }).then(value => value ? other_user_id : null)
  ));
  user_ids = user_ids.filter(user_id => !!user_id);
  user_ids = await Promise.all(user_ids.map(other_user_id =>
    discord.guild_member_has_permission(guild_id, channel_id, user_id, 'VIEW_CHANNELS').then(haz => haz ? other_user_id : null)
  ));
  user_ids = user_ids.filter(user_id => !!user_id);
  return user_ids;
}

async function handleMessageForFunReplies(guild_id, channel_id, event_id, user_id, message) {
  const DEBUG = process.env.DEBUG_FUN_REPLIES == 'true';
  const PROBABILITY = 0.05;
  if (message.trim().length == 0 || message.split(' ').filter(token => token.length > 0).every(token => token.startsWith('http://') || token.startsWith('http://') || token.startsWith('<@'))) return;
  if (Math.random() >= PROBABILITY) return;
  let model = await ai.getDynamicModel(await ai.getLanguageModels());
  if (!model) return;
  let response = null;
  switch (Math.floor(Math.random() * 8)) {
    case 0:
      if (message.length < 5 || 150 < message.length) break;
      if (ai.compareLanguageModelByPower(model, { vendor: 'openai', name: 'gpt-3.5-turbo' })) break;
      if (!await ai.createBoolean(model, user_id, `Assuming people enjoy innuendo, is it funny to respond with "That's what she said" to "${message}"?`)) break;
      response = Math.random() < 0.5 ? 'That\'s what she said!' : `"${message}", the title of ${discord.mention_user(user_id)}s sex tape!`;
      break;
    case 1:
      if (message.length < 5 || 150 < message.length) break;
      if (ai.compareLanguageModelByPower(model, { vendor: 'openai', name: 'gpt-3.5-turbo' })) break;
      if (!await ai.createBoolean(model, user_id, `Is "${message}" a typical boomer statement?`)) break;
      response = boomer.encode('ok boomer');
      break;
    case 2:
      if (message.length < 25 || 250 < message.length) break;
      const dummy_token = 'NULL';
      let extraction = await ai.createResponse(model, user_id, null, `I extract the person, animal, place, or object the input describes. I respond with ${dummy_token} if nothing can be extracted.`, message);
      if (!extraction || extraction == dummy_token || extraction.startsWith(dummy_token) || extraction.length < 10 || (extraction.match(/\p{L}/gu) ?? []).length < extraction.length * 0.5) break;
      let image_model = await ai.getDynamicModel(await ai.getImageModels());
      if (!image_model) break;
      let file = await ai.createImage(image_model, user_id, extraction, 'png');
      return discord.post(channel_id, '', event_id, true, [{ image: { url: 'attachment://image.png' } }], [], [{ filename: 'image.png', description: message, content: file }]);
    case 3:
      if (message.length < 25 || 250 < message.length) break;
      if (ai.compareLanguageModelByPower(model, { vendor: 'openai', name: 'gpt-3.5-turbo' })) break;
      response = await ai.createResponse(model, user_id, null, 'I respond with clever comebacks.', message);
      break;
    case 4:
      if (message.length < 5 || 35 < message.length) break;
      if (ai.compareLanguageModelByPower(model, { vendor: 'openai', name: 'gpt-3.5-turbo' })) break;
      response = await ai.createResponse(model, user_id, null, 'I write "roses are red" single-verse poems in reference to the input.', message);
      if (!response.toLowerCase().trim().startsWith('roses are red')) response = null;
      break;
    case 5:
      if (message.length < 5 || 150 < message.length) break;
      if (!await ai.createBoolean(model, user_id, `Assuming people enjoy innuendo, is it funny to respond with "Help me stepdiscorduser" to "${message}"?`)) break;
      response = 'Help ' + discord.mention_user(user_id) + ', stepdiscordusers!';
      break;
    case 6:
      if (message.length < 25 || 250 < message.length) break;
      if (ai.compareLanguageModelByPower(model, { vendor: 'openai', name: 'gpt-3.5-turbo' })) break;
      response = await ai.createResponse(model, user_id, null, 'I write "yo mama" jokes in reference to the input.', message);
      break;
    case 7:
      if (message.length < 5 || 50 < message.length) break;
      if (ai.compareLanguageModelByPower(model, { vendor: 'openai', name: 'gpt-3.5-turbo' })) break;
      if (!await ai.createBoolean(model, user_id, `Is it funny to respond with "weird flex but ok" to "${message}"?`)) break;
      response = 'Weird flex but ok.';
      break;
    default:
      throw new Error();
  }
  if (response) {
    if (DEBUG) {
      console.log('DEBUG FUN REPLY: ' + message + ' => ' + response);
    }
    return respond(guild_id, channel_id, event_id, response);
  }
}

async function handleMessageForTriggers(guild_id, channel_id, event_id, message) {
  let tokens = message.toLowerCase().split(' ');
  let triggers = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j <= Math.min(i + 5, tokens.length); j++) {
      triggers.push(tokens.slice(i, j).join(' '));
    }
  }
  let entries = await memory.list(Array.from(new Set(triggers)).map(trigger => `trigger:guild:${guild_id}:trigger:` + memory.mask(trigger)));
  return Promise.all(entries
    .map(entry => entry.value)
    .filter(value => typeof value == 'string' || Math.random() < value.probability)
    .map(value => typeof value == 'string' ? value : value.response)
    .map(value => respond(guild_id, channel_id, event_id, value))
  );
}

async function handleCommand(guild_id, channel_id, event_id, user_id, message, referenced_message_id, attachments, embeds, me, pure_command_handling = false) {
  if (message.length == 0) {
    return Promise.resolve();
  
  } else if (message.toLowerCase() == 'debug') {
    return reactOK(channel_id, event_id);
    
  } else if (message.toLowerCase() == 'ping') {
    return respond(guild_id, channel_id, event_id, 'pong');
    
  } else if (message.toLowerCase().startsWith('echo ')) {
    return respond(guild_id, channel_id, event_id, message.split(' ').slice(1).join(' '));
  
  } else if (message.toLowerCase() == 'fail') {
    if (user_id != process.env.OWNER_DISCORD_USER_ID) {
      return reactNotOK(channel_id, event_id);
    }
    throw new Error('This is a simulated error for production testing!');
  
  } else if (message.toLowerCase() == 'timeout') {
    if (user_id != process.env.OWNER_DISCORD_USER_ID) {
      return reactNotOK(channel_id, event_id);
    }
    return new Promise(resolve => setTimeout(resolve, 1000 * 60 * 60));
    
  } else if (message.toLowerCase() == 'dump memory' || message.toLowerCase().startsWith('dump memory ')) {
    if (user_id != process.env.OWNER_DISCORD_USER_ID) {
      return reactNotOK(channel_id, event_id);
    }
    let filter = message.split(' ').slice(2);
    return memory.toString(true,
        filter.filter(element => !element.startsWith('!')),
        filter.filter(element => element.startsWith('!')).map(element => element.substring(1))
      )
      .then(result => console.log('\n' + result))
      .then(() => reactOK(channel_id, event_id));
  
  } else if (message.toLowerCase() == 'show memory' || message.toLowerCase().startsWith('show memory ')) {
    if (user_id != process.env.OWNER_DISCORD_USER_ID) {
      return reactNotOK(channel_id, event_id);
    }
    let filter = message.split(' ').slice(2);
    return memory.toString(true,
        filter.filter(element => !element.startsWith('!')),
        filter.filter(element => element.startsWith('!')).map(element => element.substring(1))
      )
      .then(result => respond(guild_id, channel_id, event_id, result));
    
  } else if (message.toLowerCase().startsWith('clear memory')) {
    if (user_id != process.env.OWNER_DISCORD_USER_ID) {
      return reactNotOK(channel_id, event_id);
    }
    return memory.unset(message.split(' ').slice(2).join(' ')).then(() => reactOK(channel_id, event_id));
    
  } else if (message.toLowerCase().startsWith("insert memory ")) {
    if (user_id != process.env.OWNER_DISCORD_USER_ID) {
      return reactNotOK(channel_id, event_id);
    }
    message = message.substring("insert memory ".length);
    let key = message.split('=')[0];
    let value = message.split('=').slice(1).join('=');
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (!isNaN(value)) value = Number(value);
    else if (value.startsWith("json:")) value = JSON.parse(value.substring("json:".length));
    //if (value.includes(',')) value = value.split(',');
    return memory.set(key, value, 60 * 60 * 24 * 7 * 52).then(() => reactOK(channel_id, event_id));
    
  } else if (message.toLowerCase() == 'help') {
    let notification_role_name;
    if (guild_id) {
      let notification_role_id = await memory.get(`notification:role:guild:${guild_id}`, null);
      notification_role_name = !notification_role_id ?
        '@everyone' :
        await discord.guild_roles_list(guild_id)
          .then(roles => roles.filter(role => role.id === notification_role_id))
          .then(roles => roles.length > 0 ? ('@' + roles[0].name) : '@deleted-role')
    } else {
      notification_role_name = 'unknown';
    }
    let url = await identity.getPublicURL();
    return createHelpString(guild_id, discord.mention_user(me.id))
      .then(help => respond(guild_id, channel_id, event_id, `${help}\nUse ${url}/help to share this information with others outside your discord server.`));
    
  } else if (message.toLowerCase() == 'about') {
    let url = await identity.getPublicURL();
    return createAboutString(discord.mention_user(me.id))
      .then(about => respond(guild_id, channel_id, event_id, `${about}\nUse ${url}/about to share this information with others outside your discord server.`));
    
  } else if (message.toLowerCase() == 'privacy') {
    let url = await identity.getPublicURL();
    return createPrivacyString(discord.mention_user(me.id))
      .then(about => respond(guild_id, channel_id, event_id, `${about}\nUse ${url}/privacy to share this information with others outside your discord server.`));
  
  } else if (message.toLowerCase() == 'request my data') {
    if (guild_id) {
      return discord.respond(channel_id, event_id, 'To protect your data, I will only accept data requests in DM channels!');
    }
    return memory.list()
      .then(entries => entries.filter(entry => entry.key.includes(':user:' + user_id)))
      .then(entries => {
        let zip = new Zip();
        for (let entry of entries) {
          zip.file(entry.key.replace(/:/g, '_') + '.json', JSON.stringify(entry));
        }
        return zip.generateAsync({ type: "nodebuffer" });
      })
      .then(file => discord.post(channel_id, 'This is all data that I have about you.', event_id, true, [], [], [ { content: file, content_type: 'application/zip', filename: 'data_' + user_id + '.zip' } ]));
    
  } else if (message.toLowerCase() == 'good bot') {
    return discord.react(channel_id, event_id, '👍');
    
  } else if (message.toLowerCase() == 'bad bot') {
    return discord.react(channel_id, event_id, '😢');
    
  } else if (message.toLowerCase().startsWith('command start ')) {
    return memory.set(`command:user:${user_id}`, message.split(' ').slice(2).join(' '), 60 * 60)
      .then(() => reactOK(channel_id, event_id));
    
  } else if (message.toLowerCase().startsWith('command continue ')) {
    return memory.get(`command:user:${user_id}`, '')
      .then(command => memory.set(`command:user:${user_id}`, command + message.split(' ').slice(2).join(' '), 60 * 60))
      .then(() => reactOK(channel_id, event_id));
    
  } else if (message.toLowerCase() == 'command execute') {
    return memory.consume(`command:user:${user_id}`, null)
      .then(command => command ?
        handleCommand(guild_id, channel_id, event_id, user_id, command, referenced_message_id, attachments, embeds, me, pure_command_handling) :
        reactNotOK(channel_id, event_id)
      );
  
  } else if (message.toLowerCase() == 'join') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    let voice_state = await memory.get(`voice_channel:user:${user_id}`, null);
    if (!voice_state || voice_state.guild_id != guild_id) return reactNotOK(channel_id, event_id);
    let voice_channel_id = voice_state.channel_id;
    if (!voice_channel_id) return reactNotOK(channel_id, event_id);
    return discord.connect(guild_id, voice_channel_id)
      .then(() => player.registerManualJoin(guild_id))
      .then(() => reactOK(channel_id, event_id));
  
  } else if (message.toLowerCase() == 'next') {
    return handleCommand(guild_id, channel_id, event_id, user_id, 'play next', referenced_message_id, attachments, embeds, me, pure_command_handling);

  } else if (message.toLowerCase().startsWith('play ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await features.isActive(guild_id, 'player')) return respondNeedsFeatureActive(guild_id, channel_id, event_id, 'player', 'play music');
    message = message.split(' ').slice(1).join(' ');
    let shuffle = message.toLowerCase().startsWith('shuffled ');
    if (shuffle) {
      message = message.split(' ').slice(1).join(' ');
    }
    let search_string = null;
    let voice_channel_id = null;
    if (message.toLowerCase().startsWith('in ')) {
      let channel_name = message.split(' ')[1];
      voice_channel_id = await discord.guild_channels_list(guild_id).then(channels => channels.find(channel => channel.type == 2 && channel.name == channel_name)).then(channel => channel?.id); 
      if (!voice_channel_id) return respond(guild_id, channel_id, event_id, 'I cannot find the channel ' + channel_name + '!');
      search_string = message.split(' ').slice(2).join(' ');
    } else {
      let voice_state = await memory.get(`voice_channel:user:${user_id}`);
      if (!voice_state || voice_state.guild_id != guild_id) return respond(guild_id, channel_id, event_id, 'I do not know which channel to use. Either join a voice channel first or tell me explicitly which channel to use!');
      voice_channel_id = voice_state.channel_id;
      search_string = message;
    }

    let timer = setInterval(() => discord.trigger_typing_indicator(channel_id), 1000 * 10);
    return discord.trigger_typing_indicator(channel_id)
      .then(() => search_string.toLowerCase() == 'next' ? player.playNext(guild_id, voice_channel_id, false) : player.play(guild_id, voice_channel_id, search_string, true))
      .then(() => player.openInteraction(guild_id, channel_id))
      .then(() => reactOK(channel_id, event_id))
      .catch(error => respond(guild_id, channel_id, event_id, error.message))
      .finally(() => clearInterval(timer));

  } else if (message.toLowerCase() == "player") {
    return player.openInteraction(guild_id ?? await resolveGuildID(user_id), channel_id).then(() => reactOK(channel_id, event_id));

  } else if (message.toLowerCase() == "stop" || message.toLowerCase() == "leave" || message.toLowerCase() == "disconnect") {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await features.isActive(guild_id, 'player')) return respondNeedsFeatureActive(guild_id, channel_id, event_id, 'player', 'play music');
    return player.stop(guild_id).then(command => reactOK(channel_id, event_id).then(() => command));
    
  } else if (message.toLowerCase() == "pause" || message.toLowerCase() == "chill") {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await features.isActive(guild_id, 'player')) return respondNeedsFeatureActive(guild_id, channel_id, event_id, 'player', 'play music');
    return player.pause(guild_id).then(() => reactOK(channel_id, event_id));
    
  } else if (message.toLowerCase() == "resume" || message.toLowerCase() == "continue") {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await features.isActive(guild_id, 'player')) return respondNeedsFeatureActive(guild_id, channel_id, event_id, 'player', 'play music');
    return player.resume(guild_id).then(() => reactOK(channel_id, event_id));
    
  } else if (message.toLowerCase().startsWith('queue ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await features.isActive(guild_id, 'player')) return respondNeedsFeatureActive(guild_id, channel_id, event_id, 'player', 'play music');
    return player.appendToQueue(guild_id, message.split(' ').slice(1).join(' ')).then(() => reactOK(channel_id, event_id))
      
  } else if (message.toLowerCase() == 'shuffle queue') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await features.isActive(guild_id, 'player')) return respondNeedsFeatureActive(guild_id, channel_id, event_id, 'player', 'play music');
    return player.shuffleQueue(guild_id).then(() => reactOK(channel_id, event_id));
    
  } else if (message.toLowerCase() == 'clear queue') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await features.isActive(guild_id, 'player')) return respondNeedsFeatureActive(guild_id, channel_id, event_id, 'player', 'play music');
    return player.clearQueue(guild_id).then(() => reactOK(channel_id, event_id));
    
  } else if (message.toLowerCase() == 'show queue') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await features.isActive(guild_id, 'player')) return respondNeedsFeatureActive(guild_id, channel_id, event_id, 'player', 'play music');
    let queue = await player.getQueue(guild_id);
    if (queue.length == 0) {
      return respond(guild_id, channel_id, event_id, 'The queue is empty');
    }
    let buffer = '';
    for (var index = 0; index < queue.length && index < 5; index++) {
      if (index > 0) {
        buffer += ', ';
      }
      buffer += '**' + queue[index] + '**';
    }
    return respond(guild_id, channel_id, event_id, 'The queue consists of ' + buffer + ' and ' + Math.max(0, queue.length - 5) + ' more...');
  
  } else if (message.toLowerCase().startsWith('add repeating event ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) {
      return respond(guild_id, channel_id, event_id, 'I can only add a repeating event via a text channel within a guild or while you are in a voice channel. Otherwise I do not know which guild to schedule this event for.');
    }
    if (!await features.isActive(guild_id, 'repeating events')) {
      return respondNeedsFeatureActive(guild_id, channel_id, event_id, 'repeating events', 'add a repeating event');
    }
    if (!await discord.guild_member_has_permission(guild_id, null, user_id, 'MANAGE_EVENTS')) {
      return respond(guild_id, channel_id, event_id, 'You need the \'Manage Events\' permission to add repeating events.')
    }
    
    let channels = await discord.guild_channels_list(guild_id);
    message = message.substring('add repeating event '.length);
    let nameAndDescription = message.substring(0, message.indexOf(' every '));
    let name = nameAndDescription.substring(0, nameAndDescription.indexOf(':::')).trim();
    let description = nameAndDescription.substring(name.length + 3).trim();
    let parameters = message.substring(nameAndDescription.length + ' every '.length).split(' ');
    let index = 0;
    let probability = 1;
    while (parameters[index] === 'other') {
      probability *= 0.5
      index++;
    }
    let weekday = parameters[index++];
    let time = parameters[index++];
    let timezone = parameters[index++];
    let channel_name = null;
    if (index < parameters.length) {
      index++; // in
      channel_name = parameters.slice(index).join(' ');
    }
    if (name === 'null') name = null;
    if (description === 'null') description = null;
    const weekdays = [ 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday' ];
    let day = weekdays.indexOf(weekday.toLowerCase());
    let hour = parseInt(time.substring(0, time.indexOf(':')));
    let minute = parseInt(time.substring(time.indexOf(':') + 1, time.length))
    let event_channel_id = null;
    for (let channel of channels) {
      if (channel_name === channel.name) {
        event_channel_id = channel.id;
        break;
      }
    }
    let event_configs = await memory.get(`repeating_events:config:guild:${guild_id}`, []);
    event_configs.push(
      { probability: probability, name: name, channel_id: event_channel_id, schedule: { day: day, hour: hour, minute: minute, timezone: timezone }, description: description }
    );
    
    let matchesActivity = await discord.guild_members_list(guild_id)
      .then(members => members.map(member => member.user.id).map(user_id => memory.get(`activities:all:user:${user_id}`, [])))
      .then(results => Promise.all(results))
      .then(results => results.flatMap(activities => activities))
      .then(activities => activities.includes(name));
    
    if (!matchesActivity) {
      await respond(guild_id, channel_id, event_id, 'If you choose an event name that is also the same as a game, I will be able to find and notify potentially interested players automatically. I will schedule the event anyway. You can remove and re-create it at any time.');
    }
    
    return memory.set(`repeating_events:config:guild:${guild_id}`, event_configs).then(() => reactOK(channel_id, event_id));
    
  } else if (message.toLowerCase().startsWith('remove repeating event ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) {
      return respond(guild_id, channel_id, event_id, 'I can only removea repeating event via a text channel within a guild or while you are in a voice channel. Otherwise I do not know which guild to remove this event for.');
    }
    if (!await features.isActive(guild_id, 'repeating events')) {
      return respondNeedsFeatureActive(guild_id, channel_id, event_id, 'repeating events', 'remove a repeating event');
    }
    if (!await discord.guild_member_has_permission(guild_id, null, user_id, 'MANAGE_EVENTS')) {
      return respond(guild_id, channel_id, event_id, 'You need the \'Manage Events\' permission to add or remove repeating events.')
    }
    message = message.substring('remove repeating event '.length);
    let event_configs = await memory.get(`repeating_events:config:guild:${guild_id}`, []);
    let new_event_configs = [];
    for (let event_config of event_configs) {
      if (event_config.name !== message) {
        new_event_configs.push(event_config);
      }
    }
    return memory.set(`repeating_events:config:guild:${guild_id}`, new_event_configs).then(() => reactOK(channel_id, event_id));
    
  } else if (message.toLowerCase().startsWith('remember birthday ')) {
    let input = message.substring('remember birthday '.length).split(' ');
    let user_id = discord.parse_mention(input[0]);
    let day = parseInt(input[1].substring(0, input[1].indexOf('.')));
    let month = parseInt(input[1].substring(input[1].indexOf('.') + 1, input[1].length));
    return memory.set(`birthday:user:${user_id}`, { day: day, month: month })
      .then(() => reactOK(channel_id, event_id));
    
  } else if (message.toLowerCase().startsWith('notify me for ')) {
    let activity = message.substring('notify me for '.length).trim();
    return memory.set(`notify:user:${user_id}:activity:${activity}`, true).then(() => reactOK(channel_id, event_id));
  } else if (message.toLowerCase().startsWith('stop notifying me for ')) {
    let activity = message.substring('stop notifying me for '.length).trim();
    return memory.unset(`notify:user:${user_id}:activity:${activity}`).then(() => reactOK(channel_id, event_id));
    
  /*
  } else if (message.toLowerCase().startsWith('what') || message.toLowerCase().startsWith('how') || message.toLowerCase().startsWith('who') || message.toLowerCase().startsWith('when') || message.toLowerCase().startsWith('where') || message.trim().endsWith('?')) {
    let link = 'https://letmegooglethat.com/?q=' + message.trim().replace(/ /g, '+');
    return respond(guild_id, channel_id, event_id, link);
  */
    
  } else if (message.toLowerCase().startsWith("hint") || message.toLowerCase().startsWith("info") || message.toLowerCase().startsWith("information")) {
    let activity = message.split(' ').slice(1).join(' ');
    return games.getActivityHint(activity, null, null, user_id)
      .then(hint => hint != null ? respond(guild_id, channel_id, event_id, hint.text) : reactNotOK(channel_id, event_id));
      
  } else if (message.toLowerCase().startsWith('remind ')) {
    let tokens = message.split(' ').filter(token => token.length > 0);
    let index = 1;
    let to_name = tokens[index++];
    // if (to_name != 'me') return respond(guild_id, channel_id, event_id, 'I can only remind yourself for now.');
    let to_id;
    if (to_name == 'me') to_id = user_id;
    else {
      guild_id = guild_id ?? await resolveGuildID(user_id);
      if (!guild_id) return respond(guild_id, channel_id, event_id, 'I do not know who you mean.');
      if (to_name.startsWith('<@') && to_name.endsWith('>')) {
        to_id = discord.parse_mention(to_name);
      } else if (to_name.startsWith('<@&')) {
        return respond(guild_id, channel_id, event_id, 'I can only remind individual users, not roles.')
      } else {
        to_id = await discord.guild_members_list(guild_id).then(members => members.find(member => to_name == discord.member2name(member))?.user?.id);
        if (!to_id) return respond(guild_id, channel_id, event_id, 'I do not know ' + to_name + '.');
      }
    }
    let next_string = tokens[index++];
    let next;
    if (next_string == 'soon' || next_string == 'tomorrow') {
      next = Date.now() + 1000 * 60 * 60 * 24;
    } else if (next_string == 'in') {
      let count_string = tokens[index++];
      let unit_string = tokens[index++];
      let count = count_string == 'a' ? 1 : parseInt(count_string);
      if (isNaN(count)) return respond(guild_id, channel_id, event_id, 'I do not know how much ' + count + ' is.');
      if (!unit_string.endsWith('s')) unit_string += 's';
      switch (unit_string) {
        case 'minutes': next = Date.now() + 1000 * 60 * count; break;
        case 'hours': next = Date.now() + 1000 * 60 * 60 * count; break;
        case 'days': next = Date.now() + 1000 * 60 * 60 * 24 * count; break;
        case 'weeks': next = Date.now() + 1000 * 60 * 60 * 24 * 7 * count; break;
        case 'months': next = Date.now() + 1000 * 60 * 60 * 24 * 30 * count; break;
        case 'years': next = Date.now() + 1000 * 60 * 60 * 24 * 365 * count; break;
        default: return respond(guild_id, channel_id, event_id, 'I do not know ' + unit_string + '.');
      }
    } else if (next_string == 'on') {
      let date_string = tokens[index++];
      let split = date_string.indexOf('.');
      if (split < 0) return respond(guild_id, channel_id, event_id, 'I do not understand the date ' + date_string + '.');
      let day = parseInt(date_string.substring(0, split));
      let month = parseInt(date_string.substring(split + 1)) - 1;
      if (isNaN(day) || isNaN(month)) return respond(guild_id, channel_id, event_id, 'I do not understand the date ' + date_string + '.');
      let nextdate = new Date();
      if (month < nextdate.getUTCMonth() || (nextdate.getUTCMonth() == month && nextdate < day)) nextdate.setUTCFullYear(nextdate.getFullYear() + 1);
      nextdate.setUTCDate(1); // do this to avoid problems where the day is out of range for a specific month
      nextdate.setUTCMonth(month);
      nextdate.setUTCDate(day);
      nextdate.setUTCHours(12, 0, 0, 0);
      next = nextdate.getTime();
    } else {
      next = Date.now() + 1000 * 60 * 60 * 24;
    }
    let text = tokens.slice(index++).join(' ');
    let reminder = {
      text: text,
      next: next,
      from_username: to_name == 'me' ? 'You' : discord.member2name(await discord.guild_member_retrieve(guild_id, user_id)),
      from_id: user_id,
      to_username: to_name == 'me' ? 'you' : to_name,
      to_id: to_id
    };
    return memory.get(`reminders:user:${to_id}`, [])
      .then(reminders => memory.set(`reminders:user:${to_id}`, reminders.concat([reminder])))
      .then(() => reactOK(channel_id, event_id))
      
  } else if (message.toLowerCase().startsWith('random ')) {
    message = message.split(' ').slice(1).join(' ');
    if (message.includes(';')) {
      let tokens = message.split(';').map(token => token.trim());
      return respond(guild_id, channel_id, event_id, tokens[Math.floor(Math.random() * tokens.length)]);
    } else {
      let tokens = message.split(' ');
      if (tokens.length == 1 && !isNaN(tokens[0])) {
        return respond(guild_id, channel_id, event_id, '' + Math.floor(Math.random() * parseInt(tokens[0])));
      } else if (tokens.length == 2 && !isNaN(tokens[0]) && !isNaN(tokens[1])) {
        return respond(guild_id, channel_id, event_id, '' + Math.floor(parseInt(tokens[0]) + Math.random() * (parseInt(tokens[1]) - parseInt(tokens[0]))));
      } else {
        return respond(guild_id, channel_id, event_id, tokens[Math.floor(Math.random() * tokens.length)]);
      }
    }
  
  } else if (message.toLowerCase().startsWith('create alias ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, 'create an alias');
    let name = message.split(' ')[2];
    let command = message.split(' ').slice(3).join(' ');
    return memory.set(`alias:` + memory.mask(name) + `:guild:${guild_id}`, command).then(() => reactOK(channel_id, event_id));
    
  } else if (message.toLowerCase().startsWith('remove alias ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, 'remove an alias');
    let name = message.split(' ')[2];
    return memory.unset(`alias:` + memory.mask(name) + `:guild:${guild_id}`).then(() => reactOK(channel_id, event_id));

  } else if (message.toLowerCase().startsWith('tournament create ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id);
    if (!await features.isActive(guild_id, 'tournament')) return respondNeedsFeatureActive(guild_id, channel_id, event_id, 'tournament', 'create a tournament');
    message = message.split(' ').slice(2).join(' ');
    let tokens = message.split(',');
    let name = tokens[0].trim();
    let date = new Date(tokens[1].trim());
    let game_masters = tokens[2].split(';').map(mention => discord.parse_mention(mention)).filter(user => !!user);
    let team_size = parseInt(tokens[3].trim());
    let locations = tokens[4].split(';').map(location => location.trim());
    let length = parseInt(tokens[5].trim());
    return tournament.create(guild_id, name, date, game_masters, team_size, locations, length)
      .then(() => reactOK(channel_id, event_id))
      .catch(error => respond(guild_id, channel_id, event_id, error.message));

  } else if (message.toLowerCase().startsWith('tournament define team ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    message = message.split(' ').slice(3).join(' ');
    let split = message.indexOf(':');
    if (split < 0) return respond(guild_id, channel_id, event_id, 'Team name and list of members must be split by \':\'.');
    let name = message.substring(0, split);
    let players = message.substring(split + 1, message.length).split(' ').filter(token => token.length > 0).map(mention => discord.parse_mention(mention));
    if (name.length == 0 || players.some(player => !player)) return reactNotOK(channel_id, event_id);
    return tournament.define_team(guild_id, user_id, name, players)
      .then(() => reactOK(channel_id, event_id))
      .catch(error => respond(guild_id, channel_id, event_id, error.message));
    
  } else if (message.toLowerCase().startsWith('tournament dissolve team ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    message = message.split(' ').slice(3).join(' ');
    let name = message.trim();
    return tournament.dissolve_team(guild_id, user_id, name)
      .then(() => reactOK(channel_id, event_id))
      .catch(error => respond(guild_id, channel_id, event_id, error.message));
        
  } else if (message.toLowerCase().startsWith('tournament replace ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    message = message.split(' ').slice(2).join(' ');
    let players = message.split(' ').filter(token => token.length > 0).map(mention => discord.parse_mention(mention));
    if (players.length != 2) return respond(guild_id, channel_id, event_id, 'You must specify exactly two players.');
    return tournament.replace_player(guild_id, user_id, players[0], players[1])
      .then(() => reactOK(channel_id, event_id))
      .catch(error => respond(guild_id, channel_id, event_id, error.message));
    
  } else if (message.toLowerCase() == 'tournament prepare') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    return tournament.prepare(guild_id, user_id)
      .then(() => reactOK(channel_id, event_id))
      .catch(error => respond(guild_id, channel_id, event_id, error.message));
    
  } else if (message.toLowerCase() == 'tournament start') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    return tournament.start(guild_id, user_id)
      .then(() => reactOK(channel_id, event_id))
      .catch(error => respond(guild_id, channel_id, event_id, error.message));

  } else if (message.toLowerCase().startsWith('configure ')) {
    message = message.split(' ').slice(1).join(' ');
    let activities = await memory.get(`activities:all:user:${user_id}`, []);
    let activity = activities.find(activity => message.startsWith(activity));
    if (!activity) return reactNotOK(channel_id, event_id);
    message = message.substring(activity.length).trim();
    let accounts = [];
    for (let account_string of message.split(',')) {
      let tokens = account_string.trim().split(' ');
      if (tokens.length < 1 || 2 < tokens.length) return reactNotOK(channel_id, event_id);
      let server = tokens.length == 2 ? tokens[0] : null;
      let name = tokens.length == 2 ? tokens[1] : tokens[0];
      accounts.push({ server: server, name: name });
    }
    return memory.set('activity_hint_config:activity:' + activity + ':user:' + user_id, accounts)
      .then(() => reactOK(channel_id, event_id));
      
  } else if (message.toLowerCase().startsWith('add trigger ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, 'add a trigger');
    message = message.substring('add trigger '.length);
    let probability = 1;
    if (message.includes('%') && !isNaN(message.substring(0, message.indexOf('%')))) {
      let token = message.substring(0, message.indexOf('%'));
      probability = parseInt(token) / 100.0;
      message = message.substring(token.length + 1, message.length).trim();
    }
    let index = message.indexOf(':');
    if (index < 0) return reactNotOK(channel_id, event_id);
    let trigger = message.substring(0, index).trim().split(' ').join(' ').toLowerCase();
    let response = message.substring(index + 1, message.length).trim(); // no to lower case here
    if (trigger.length == 0 || response.length == 0) return reactNotOK(channel_id, event_id);
    return memory.set(`trigger:guild:${guild_id}:trigger:` + memory.mask(trigger), { probability: probability, response: response })
      .then(() => reactOK(channel_id, event_id));
    
  } else if (message.toLowerCase().startsWith('remove trigger ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, 'remove a trigger');
    message = message.substring('remove trigger '.length);
    trigger = message.trim().toLowerCase();
    return memory.unset(`trigger:guild:${guild_id}:trigger:` + memory.mask(trigger))
      .then(() => reactOK(channel_id, event_id));
  
  } else if (message.toLowerCase().startsWith('define ')) {
    message = message.substring('define '.length).trim();
    if (message.length == 0) return reactNotOK(channel_id, event_id);
    return urban_dictionary.lookup(message)
      .then(result => respond(guild_id, channel_id, event_id, result ? `${result.word}: ${result.definition} (${result.permalink})` : `No entry found for ${message}.`));
  
  } else if (message.toLowerCase().startsWith('activate ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, 'activate a feature');
    let feature = message.split(' ').slice(1).join(' ');
    if (!features.list().includes(feature)) return reactNotOK(channel_id, event_id);
    let needed_permissions = await Promise.all(permissions.required([ feature ]).map(permission => discord.guild_member_has_permission(guild_id, null, me.id, permission).then(has => has ? null : permission))).then(names => names.filter(name => !!name));
    if (needed_permissions.length > 0) {
      return respond(guild_id, channel_id, event_id, `Before I can activate ${feature}, pls grant me the following permissions (via Server Settings -> Roles -> ${me.username} -> Permissions): ` + needed_permissions.map(name => `**${name}**`).join(', ') + '.');
    }
    return features.setActive(guild_id, feature, true).then(() => reactOK(channel_id, event_id));
    
  } else if (message.toLowerCase().startsWith('deactivate ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, 'deactivate a feature');
    let feature = message.split(' ').slice(1).join(' ');
    if (!features.list().includes(feature)) return reactNotOK(channel_id, event_id);
    return features.setActive(guild_id, feature, false).then(() => reactOK(channel_id, event_id));
    
  } else if (message.toLowerCase() == 'raid lockdown') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, 'lock down the server');
    if (!await features.isActive(guild_id, 'raid protection')) return respondNeedsFeatureActive(guild_id, channel_id, event_id, 'raid protection', 'lock down the server');
    return raid_protection.lockdown(guild_id).then(() => reactOK(channel_id, event_id));
    
  } else if (message.toLowerCase() == 'raid all clear') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, 'lift lockdown the server');
    return raid_protection.all_clear(guild_id).then(() => reactOK(channel_id, event_id));

  } else if (message.toLowerCase().startsWith('subscribe to ')) {
    let tokens = message.split(' ').slice(2).filter(token => token.length > 0);
    let link = tokens[0];
    let filter = tokens.slice(1).join(' ');
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!link) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, 'add subscription');
    return subscriptions.add(guild_id, channel_id, link, filter)
      .then(() => reactOK(channel_id, event_id))
      .catch(error => respond(guild_id, channel_id, event_id, error.message));

  } else if (message.toLowerCase().startsWith('unsubscribe from ')) {
    let tokens = message.split(' ').slice(2).filter(token => token.length > 0);
    let link = tokens[0];
    let filter = tokens.slice(1).join(' ');
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!link) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, 'remove subscription');
    return subscriptions.remove(guild_id, channel_id, link, filter)
      .then(() => reactOK(channel_id, event_id))
      .catch(error => respond(guild_id, channel_id, event_id, error.message));

  } else if (message.toLowerCase() == 'automatic roles list' || message.toLowerCase() == 'automatic roles list rules') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, 'auto-set roles');
    if (!await features.isActive(guild_id, 'role management')) return respondNeedsFeatureActive(guild_id, channel_id, event_id, 'role management', 'auto-manage roles');
    return role_management.to_string(guild_id).then(string => respond(guild_id, channel_id, event_id, string));

  } else if (message.toLowerCase().startsWith('automatic roles create rule ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, 'auto-set roles');
    if (!await features.isActive(guild_id, 'role management')) return respondNeedsFeatureActive(guild_id, channel_id, event_id, 'role management', 'auto-manage roles');
    message = message.split(' ').slice(4).join(' ');
    return role_management.add_new_rule(guild_id, message)
      .then(() => reactOK(channel_id, event_id))
      .catch(error => respond(guild_id, channel_id, event_id, error.message));
    
  } else if (message.toLowerCase() == 'automatic roles update') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, 'auto-set roles');
    if (!await features.isActive(guild_id, 'role management')) return respondNeedsFeatureActive(guild_id, channel_id, event_id, 'role management', 'auto-manage roles');
    return role_management.update_all(guild_id).then(() => reactOK(channel_id, event_id));
  
  } else if (message.toLowerCase().startsWith('translate automatically to ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, 'enable auto translation');
    let target_language = message.split(' ').slice(3).join(' ').trim().toLowerCase();
    return translator.configure_translate(guild_id, channel_id, target_language == 'nothing' ? null : target_language)
      .then(() => reactOK(channel_id, event_id));
  
  } else if (message.toLowerCase().startsWith('translate to ') || message.toLowerCase().startsWith('translate that to ') || message.toLowerCase().startsWith('translate this to ')) {
    message = message.substring(message.indexOf('to') + 2).trim();
    let split = message.indexOf(':');
    if (!split || split < 0) return reactNotOK(channel_id, event_id);
    let language = message.substring(0, split).trim();
    let text = message.substring(split + 1).trim();
    return handleLongResponse(channel_id, () => ai.getLanguageModels()
      .then(models => ai.getDynamicModel(models))
      .then(model => model ? translator.translate(model, user_id, language, text) : null)
      .then(translation => translation ? respond(guild_id, channel_id, event_id, translation) : reactNotOK(channel_id, event_id))
    );
  
  } else if (message.toLowerCase().startsWith('draw ')) {
    message = message.split(' ').slice(1).join(' ');
    let model = await ai.getDynamicModel(await ai.getImageModels());
    if (!model) return reactNotOK(channel_id, event_id);
    return handleLongResponse(channel_id, () => ai.createImage(model, user_id, message, 'png')
      .then(image => image ? image : Promise.reject())
      .then(file => discord.post(channel_id, '', event_id, true, [{ image: { url: 'attachment://image.png' } }], [], [{ filename: 'image.png', description: message, content: file }]))
      .catch(error => error ? respond(guild_id, channel_id, event_id, error.message) : reactNotOK(channel_id, event_id))
    );
  
  } else if (message.toLowerCase().startsWith('edit ')) {
    message = message.split(' ').slice(1).join(' ');
    if (!referenced_message_id) return respond(guild_id, channel_id, event_id, 'Please reply to the original image!');
    let referenced_message = await discord.message_retrieve(channel_id, referenced_message_id);
    let attachment = referenced_message.attachments && referenced_message.attachments.length == 1 && referenced_message.attachments[0].content_type.startsWith('image/') ? referenced_message.attachments[0] : null;
    if (!attachment) {
      let embed = referenced_message.embeds && referenced_message.embeds.length == 1 && referenced_message.embeds[0].image ? referenced_message.embeds[0].image : null;
      if (embed) {
        attachment = { url: embed.url, content_type: 'image/' + embed.url.split('.').slice(-1) };
      }
    }
    if (!attachment) return respond(guild_id, channel_id, event_id, 'Referenced message does not contain exactly one image!');
    let tokens = message.split(' ').filter(token => token.length > 0);
    let regions = [{ x: parseFloat(tokens[0]), y: parseFloat(tokens[1]), w: parseFloat(tokens[2]), h: parseFloat(tokens[3]) }];
    message = tokens.slice(4).join(' ');
    let image = await streamAttachment(attachment);
    let format = attachment.content_type.split('/')[1];
    let model = await ai.getDynamicModel(await ai.getImageModels());
    return handleLongResponse(channel_id, () => ai.editImage(model, user_id, image, format, message, regions)
      .then(image => image ? image : Promise.reject())
      .then(file => discord.post(channel_id, '', event_id, true, [{ image: { url: 'attachment://image.' + format } }], [], [{ filename: 'image.' + format, description: message, content: file }]))
      .catch(error => error ? respond(guild_id, channel_id, event_id, error.message) : reactNotOK(channel_id, event_id))
    );
  
  } else if (message.toLowerCase().startsWith('say ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    let connection = await memory.get(`voice_channel:user:${user_id}`, null);
    if (!connection || connection.guild_id != guild_id || !connection.channel_id) return reactNotOK(channel_id, event_id);
    return respond(connection.guild_id, connection.channel_id, undefined, message.split(' ').slice(1).join(' '), user_id);

  } else if (message.toLowerCase() == 'mirror' || message.toLowerCase().startsWith('mirror to ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, 'mirror server');
    let mirror_guild_id = message.includes(' ') ? message.split(' ').slice(2).join(' ') : undefined;
    if (mirror_guild_id && !await features.isActive(mirror_guild_id, 'mirror')) return respondNeedsFeatureActive(guild_id, channel_id, event_id, 'mirror', 'mirror');
    return mirror.configure_mirror(guild_id, user_id, mirror_guild_id).then(() => reactOK(channel_id, event_id));
  
  } else if (message.toLowerCase().startsWith('personality ')) {
    message = message.split(' ').slice(1).join(' ').trim();
    if (!message.includes(':')) return reactNotOK(channel_id, event_id);    
    let scope = message.substring(0, message.indexOf(':'));
    let personality = message.substring(message.indexOf(':') + 1, message.length);
    if (personality.length == 0) return reactNotOK(channel_id, event_id);
    guild_id = guild_id ?? await resolveGuildID(user_id);
    let key = 'ai:personality:';
    switch(scope) {
      case 'server':
        if (!guild_id) return reactNotOK(channel_id, event_id);
        if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, 'define AI personality for server');
        key += `guild:${guild_id}`;
        break;
      case 'channel':
        if (guild_id && !await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, 'define AI personality for channel');
        key += `channel:${channel_id}`;
        break;
      case 'user':
        key += `user:${user_id}`;
        break;
      default:
        return respond(guild_id, channel_id, event_id, 'You need to define the scope of the personality (one of "server", "channel", or "user")!');
    }
    return (message.toLowerCase() == 'reset' ? memory.unset(key) : memory.set(key, personality))
      .then(() => reactOK(channel_id, event_id));
  
  } else if (message.toLowerCase() == 'configure voice' || message.toLowerCase() == 'clone voice') {
    let poem = 'The quick brown fox jumps over the lazy dog.' + '\n' + 
      'The pleasure of Shawn’s company is what I most enjoy.' + '\n' +
      'He put a tack on Ms. Yancey’s chair when she called him a horrible boy.' + '\n' +
      'At the end of the month he was flinging two kittens across the width of the room.' + '\n' +
      'I count on his schemes to show me a way now of getting away from my gloom.';
    await memory.set(`voice_clone:in_progress:user:${user_id}`, true, 60 * 5);
    return respond(guild_id, channel_id, event_id,
      'To clone your voice, I need you to record sample. It should be about a minute long, and of good quality. Try to avoid background noise. ' + 
      'Please send me a voice message (only works from Discord mobile app) repeating the following poem again and again until the message is at least a minute long:' + '\n\n'
      + poem + '\n\n'
      + 'You have five minutes to send me a voice message. You can restart the process with the same command any time.'
    );
  
  } else if (message.toLowerCase().startsWith('start vote ')) {
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, "start a vote");
    message = message.split(' ').slice(2).join(' ');
    let tokens = message.split(';');
    if (tokens.length != 4) return reactNotOK(channel_id, event_id);
    let description = tokens[0];
    if (!description.includes(':')) return reactNotOK(channel_id, event_id);
    let title = description.split(':', 2)[0].trim();
    let text = description.split(':', 2)[1].trim();
    let length = parseFloat(tokens[1]);
    if (isNaN(length)) return reactNotOK(channel_id, event_id);
    let choices = tokens[2].split(',').map(choice => choice.trim()).map(choice => choice.substring(0, 80)).filter(choice => choice.length > 0);
    if (title.length == 0 || text.length == 0 || choices.length == 0) return reactNotOK(channel_id, event_id);
    let roles = tokens[3].split(' ').map(string => string.trim()).filter(string => string.length > 0).map(discord.parse_role).filter(role_id => !!role_id);
    let users = tokens[3].split(' ').map(string => string.trim()).filter(string => string.length > 0).map(discord.parse_mention).filter(role_id => !!role_id);
    return democracy.startVote(guild_id, channel_id, event_id, title, text, Date.now() + 1000 * 60 * 60 * length, choices, roles, users)
      .then(() => reactOK(channel_id, event_id));
  
  } else if (message.toLowerCase() == 'end vote' && referenced_message_id) {
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(guild_id, channel_id, event_id, "end a vote");
    return democracy.endVote(guild_id, channel_id, referenced_message_id)
      .then(() => reactOK(channel_id, event_id));
  
  } else if (message.toLowerCase() == 'mute for me') {
    return memory.set(`mute:user:${user_id}`, true, 60 * 60 * 24 * 7 * 13)
      .then(() => reactOK(channel_id, event_id));
    
  } else if (await delayed_memory.materialize(`response:` + memory.mask(message) + `:user:${user_id}`)) {
    return reactOK(channel_id, event_id);

  } else {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (guild_id) {
      let tokens = message.split(' ');
      let alias = await memory.get(`alias:` + memory.mask(tokens[0]) + `:guild:${guild_id}`, undefined);
      if (alias) {
        message = (alias + ' ' + message.substring(tokens[0].length + 1)).trim();
        return handleCommand(guild_id, channel_id, event_id, user_id, message, referenced_message_id, attachments, embeds, me, pure_command_handling);
      }
    }

    if (pure_command_handling) {
      throw new Error('Unknown command: ' + message);
    }

    const try_fix_command = true;
    let command = try_fix_command ? await fixCommand(guild_id, user_id, message) : null;
    if (command) {
      try {
        return await handleCommand(guild_id, channel_id, event_id, user_id, command, referenced_message_id, attachments, embeds, me, true);
      } catch (error) {
        if(error.message.startsWith('Unknown command: ')) {
          // just continue
        } else {
          throw error;
        }
      }
    }

    if (!attachments && attachments.length == 0) attachments = [];
    if (embeds) attachments = attachments.concat(embeds.filter(embed => embed.url).map(embed => { return { url: embed.url }; }));
    if (referenced_message_id) {
      let message = await discord.message_retrieve(channel_id, referenced_message_id);
      attachments = attachments.concat(message.attachments);
      attachments = attachments.concat(message.embeds.filter(embed => embed.url).map(embed => { return { url: embed.url }; }));
    }
    for (let attachment of attachments) {
      if (attachment.content_type) continue;
      let uri = url.parse(attachment.url);
      let canary = await curl.request_full({ method: 'HEAD', hostname: uri.hostname, path: uri.path, query: uri.query });
      attachment.content_type = canary.headers['content-type'];
    }

    return handleLongResponse(channel_id, () => createAIResponse(guild_id, channel_id, user_id, message, attachments))
      .then(response => response ?? `I\'m sorry, I do not understand. Use \'<@${me.id}> help\' to learn more.`)
      .then(response => respond(guild_id, channel_id, event_id, response));
  }
}

async function fixCommand(guild_id, user_id, message) {
  let model = await ai.getDynamicModel(await ai.getLanguageModels()); // ai.getDefaultDynamicModelSafety() + (1 - ai.getDefaultDynamicModelSafety()) / 2
  if (ai.compareLanguageModelByPower(model, { vendor: 'openai', name: 'gpt-3.5-turbo' })) return null;
  let context = await createHelpString(guild_id, '' /*discord.mention_user((await discord.me()).id)*/);
  const dummy_token = 'NULL';
  let command = await ai.createResponse(model, user_id, null, context, `Fix the command "${message}". Respond with the fixed command only. Respond with "${dummy_token}" if it is not a valid command.`);
  if (!command) return null;
  if (command && ((command.startsWith('\'') && command.endsWith('\'')) || (command.startsWith('"') && command.endsWith('"')))) command = command.substring(1, command.length - 1);
  if (command == dummy_token || command.startsWith(dummy_token)) return null;
  return command.trim();
}

async function createAIResponse(guild_id, channel_id, user_id, message, attachments) {
  attachments = attachments.filter(attachment => attachment.content_type.startsWith('image/'));
  let model = await ai.getDynamicModel(await ai.getLanguageModels(), ai.getDefaultDynamicModelSafety() * (guild_id ? 1 : 0.5));
  if (!model) return null;
  let system_message = await createAIContext(guild_id, channel_id, user_id, message, model);
  let response = await ai.createResponse(model, user_id, `channel:${channel_id}:user:${user_id}`, system_message, message, attachments);
  if (response.startsWith('"') && response.endsWith('"')) response = response.substring(1, response.length - 1)
  return response;
}

async function createAIContext(guild_id, channel_id, user_id, message, model) {
  // basic identity information
  let me = await discord.me();
  let system_message = await createBasicAIContext(guild_id, me);

  // personality
  let personality = await memory.get(`ai:personality:channel:${channel_id}`, null)
    ?? (guild_id ? await memory.get(`ai:personality:guild:${guild_id}`, null) : null)
    ?? await memory.get(`ai:personality:user:${user_id}`, null);
  if (personality) {
    if (!personality.match(/.*[\.\?\!]$/)) personality += '.';
    system_message += ' ' + personality;
  }

  // information about others
  let your_name = guild_id ? await discord.guild_member_retrieve(guild_id, user_id).then(discord.member2name) : await discord.user_retrieve(user_id).then(discord.user2name);
  system_message += ` Your name is ${your_name}.`;
  let mentioned_entities = message.match(/<@(.*?)>/g) ?? [];
  let mentioned_members = mentioned_entities.filter(mention => mention.startsWith('<@') && !mention.startsWith('<@&')).map(mention => discord.parse_mention(mention));
  let mentioned_roles = mentioned_entities.filter(mention => mention.startsWith('<@&')).map(mention => discord.parse_role(mention));
  mentioned_members.push(user_id);
  if (guild_id) {
    let guild = await discord.guild_retrieve(guild_id);
    system_message += ` I am in a Discord server called ${guild.name}.`;
    mentioned_roles = await Promise.all(Array.from(new Set(mentioned_roles)).map(role_id => discord.guild_role_retrieve(guild_id, role_id)));
    for (let role of mentioned_roles) {
      let members_with_role = await discord.guild_members_list(guild_id, role.id).then(members => members.map(member => member.user.id));
      mentioned_members = members_with_role.concat(members_with_role);
      system_message += ` The name of <@&${role.id}> is ${role.name}` + (members_with_role.length > 0 ? ', members are ' + members_with_role.map(user_id => discord.mention_user(user_id)).join(', ') : '') + '.';
    }
    let members = await Promise.all(Array.from(new Set(mentioned_members)).map(user_id => discord.guild_member_retrieve(guild_id, user_id)));
    for (let member of members) {
      let activities = await memory.get(`activities:all:user:${member.user.id}`, []);
      system_message += ` The name of ${discord.mention_user(member.user.id)} is ${discord.member2name(member)}` + (activities.length > 0 ? ', he/she plays ' + activities.join(', ') : '') + '.';
    }
  } else {
    let users = await Promise.all(Array.from(new Set(mentioned_members)).map(user_id => discord.user_retrieve(user_id)));
    for (let user of users) {
      let activities = await memory.get(`activities:all:user:${user.id}`, []);
      system_message += ` The name of ${discord.mention_user(user.id)} is ${discord.user2name(user)}` + (activities.length > 0 ? ', he/she plays ' + activities.join(', ') : '') + '.';
    }
  }

  // complex information about how myself
  const help_prompt = `Assuming I am a Discord bot, is "${message}" a question about me, my capabilities, or how to interact with me?`;
  let about_me = (await createHelpString(guild_id, discord.mention_user(me.id))) + '\n' + (await createAboutString(discord.mention_user(me.id)));
  if (help_prompt.length > about_me.length || await ai.createBoolean(model, user_id, help_prompt)) {
    system_message += ' ' + about_me;
  }

  return system_message;
}

async function createBasicAIContext(guild_id, me) {
  let my_name = guild_id ? await discord.guild_member_retrieve(guild_id, me.id).then(discord.member2name) : discord.user2name(me);
  return `My name is ${my_name}. I am a Discord bot.`;
}

async function createHelpString(guild_id, my_name) {
  let notification_role_name;
  if (guild_id) {
    let notification_role_id = await memory.get(`notification:role:guild:${guild_id}`, null);
    notification_role_name = !notification_role_id ?
      '@everyone' :
      await discord.guild_roles_list(guild_id)
        .then(roles => roles.filter(role => role.id === notification_role_id))
        .then(roles => roles.length > 0 ? ('@' + roles[0].name) : '@deleted-role')
  } else {
    notification_role_name = 'unknown';
  }
  return ('' + fs.readFileSync('./help.txt'))
    .replace(/\$\{about_instruction\}/g, 'Use \'${name} about\'')
    .replace(/\$\{name\}/g, my_name)
    .replace(/\$\{notification_role\}/g, notification_role_name);
}

async function createAboutString(my_name) {
  let url = await identity.getPublicURL();
  return ('' + fs.readFileSync('./about.txt'))
    .replace(/\$\{name\}/g, my_name)
    .replace(/\$\{version\}/g, JSON.parse('' + fs.readFileSync('package.json')).version)
    .replace(/\$\{link_code\}/g, url + '/code')
    .replace(/\$\{link_discord_add\}/g, url + '/invite')
    .replace(/\$\{link_monitoring\}/g, url + '/monitoring')
    .replace(/\$\{help\}/g, url + '/help')
    .replace(/\$\{privacy\}/g, url + '/privacy');
}

async function createPrivacyString(my_name) {
  let url = await identity.getPublicURL();
  return ('' + fs.readFileSync('./privacy.txt'))
    .replace(/\$\{name\}/g, my_name)
    .replace(/\$\{version\}/g, JSON.parse('' + fs.readFileSync('package.json')).version)
    .replace(/\$\{link_code\}/g, url + '/code')
    .replace(/\$\{link_discord_add\}/g, url + '/invite')
    .replace(/\$\{link_monitoring\}/g, url + '/monitoring')
    .replace(/\$\{help\}/g, url + '/help')
    .replace(/\$\{privacy\}/g, url + '/privacy');
}

async function handleLongResponse(channel_id, func) {
  let timer = setInterval(() => discord.trigger_typing_indicator(channel_id), 1000 * 10);
  return discord.trigger_typing_indicator(channel_id)
    .then(() => func())
    .finally(() => clearInterval(timer));
}

async function respond(guild_id, channel_id, event_id, message, sender_user_id = undefined) {
  if (!event_id && guild_id && ((await discord.guild_channel_retrieve(null, channel_id)).type & 2) != 0) {
    const codec = 'mp3';
    let me = await discord.me();
    const dummy_token = 'NULL';
    let languageCode = await ai.createResponse(
      await ai.getDynamicModel(await ai.getLanguageModels()), me.id, null,
      `I determine the BCP 47 language tag representing the language of a given text. I ignore typos. I respond with the language tag only. I respond with ${dummy_token} if no clear language can be determined.`,
      message
    );
    if (!languageCode || !languageCode.match(/^([a-zA-Z0-9]+-)*[a-zA-Z0-9]+/)) languageCode = 'en';
    let model = await ai.getDynamicModel(await ai.getVoiceModels(sender_user_id ?? me.id));
    if (sender_user_id && model.name != sender_user_id) message = discord.mention_user(sender_user_id) + ' says: ' + message;
    let mentioned_entities = message.match(/<@(.*?)>/g) ?? [];
    for (let mentioned_member of mentioned_entities.filter(mention => mention.startsWith('<@') && !mention.startsWith('<@&')).map(mention => discord.parse_mention(mention))) { 
      let member = await discord.guild_member_retrieve(guild_id, mentioned_member);
      while (message.includes(discord.mention_user(mentioned_member))) {
        message = message.replace(discord.mention_user(mentioned_member), discord.member2name(member));
      }
    }
    for (let mentioned_role of mentioned_entities.filter(mention => mention.startsWith('<@&')).map(mention => discord.parse_role(mention))) { 
      let role = await discord.guild_role_retrieve(guild_id, mentioned_role);
      while (message.includes(discord.mention_role(mentioned_role))) {
        message = message.replace(discord.mention_role(mentioned_role), role.name);
      }
    }
    let audio = await ai.createVoice(model, sender_user_id ?? me.id, message, languageCode, 'neutral', codec);
    if (!audio) return discord.respond(channel_id, event_id, message);
    return player.play(guild_id, channel_id, { content: audio, codec: codec }, false);
  } else {
    return discord.respond(channel_id, event_id, message);
  }
}

async function reactOK(channel_id, event_id) {
  return event_id ? discord.react(channel_id, event_id, '👍') : undefined;
}

async function reactNotOK(channel_id, event_id) {
  return event_id ? discord.react(channel_id, event_id, '👎') : undefined;
}

async function hasMasterPermission(guild_id, user_id) {
  return discord.guild_member_has_permission(guild_id, null, user_id, 'MANAGE_SERVER');
}

async function respondNeedsMasterPermission(guild_id, channel_id, event_id, action) {
  return respond(guild_id, channel_id, event_id, `You need the permission 'Manage Server' to ${action}.`);
}

async function respondNeedsFeatureActive(guild_id, channel_id, event_id, feature, action) {
  return discord.me().then(me => respond(guild_id, channel_id, event_id, `The feature ${feature} needs to be active to ${action}. Use '<@${me.id}> activate ${feature}' to turn it on.`));
}

async function resolveGuildID(user_id) {
  return memory.get(`voice_channel:user:${user_id}`, null).then(info => info ? info.guild_id : null);
}

module.exports = { handle }
