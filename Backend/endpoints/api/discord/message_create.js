const process = require('process');
const fs = require('fs');
const curl = require('../../../shared/curl.js');
const memory = require('../../../shared/memory.js');
const delayed_memory = require('../../../shared/delayed_memory.js');
const discord = require('../../../shared/discord.js');
const player = require('../../../shared/player.js');
const games = require('../../../shared/games/games.js');
const wow = require('../../../shared/games/wow.js');
const lol = require('../../../shared/games/lol.js');
const urban_dictionary = require('../../../shared/urban_dictionary.js');
const tournament = require('../../../shared/tournament.js');
const identity = require('../../../shared/identity.js');
const features = require('../../../shared/features.js');
const permissions = require('../../../shared/permissions.js');
const raid_protection = require('../../../shared/raid_protection.js');
const subscriptions = require('../../../shared/subscriptions.js');
const role_management = require('../../../shared/role_management.js');
const { respond } = require('../../../shared/discord.js');

async function handle(payload) {
  return handle0(payload.guild_id, payload.channel_id, payload.id, payload.author.id, payload.author.username, payload.content, payload.referenced_message?.id)
    .then(() => undefined);
}

async function handle0(guild_id, channel_id, event_id, user_id, user_name, message, referenced_message_id) {
  message = message.trim();
  
  let mentioned = false;
  let me = await discord.me();
  if (me.id == user_id) {
    return; // avoid cycles
  } else if (message.startsWith(`@${me.username}`)) {
    mentioned = true;
    message = message.substring(1 + me.username.length).trim();
  } else if (message.startsWith(`<@${me.id}>`) || message.startsWith(`<@!${me.id}>`)) {
    mentioned = true;
    message = message.substring(message.indexOf('>') + 1).trim();
  } else if (guild_id && message.startsWith('<@&')) {
    let role = undefined;
    let roles = await discord.guild_roles_list(guild_id);
    for (let index = 0; index < roles.length; index++) {
      if (roles[index].name === me.username) {
        role = roles[index];
        break;
      }
    }
    mentioned = role && message.startsWith(`<@&${role.id}>`);
    if (mentioned) message = message.substring(message.indexOf('>') + 1).trim();
  } else {
    mentioned = !guild_id && user_id != me.id;
  }
  
  return Promise.all([
      mentioned ?
        handleCommand(guild_id, channel_id, event_id, user_id, user_name, message, referenced_message_id, me)
          .catch(ex => discord.respond(channel_id, event_id, `I'm sorry, I ran into an error.`).finally(() => { throw ex; })) :
        Promise.resolve(),
      handleMessage(guild_id, channel_id, event_id, user_id, user_name, message, referenced_message_id, mentioned),
        guild_id ? features.isActive(guild_id, 'raid protection').then(active => active ? raid_protection.on_guild_message_create(guild_id, user_id) : Promise.resolve()) : Promise.resolve()
    ]).then(results => results[0]);
}

async function handleMessage(guild_id, channel_id, event_id, user_id, user_name, message, referenced_message_id, mentioned) {
  let promises = [];
  
  if (guild_id && message.includes('@') && message.split('').some((char, index) => char == '@' && (index == 0 || message.charAt(index-1) != '<'))) {
    let promise = discord.guild_members_list(guild_id)
      .then(members => members
        .map(member => member.user.id)
        .filter(other_user_id => user_id !== other_user_id && !message.includes(other_user_id))
        .map(other_user_id => memory.get(`activities:all:user:${other_user_id}`, [])
          .then(other_activities => {
            for (let index = 0; index < message.length; index++) {
              if (message.charAt(index) !== '@' || (index > 0 && message.charAt(index-1) === '<')) continue;
              let f = index + 1;
              for (let t = f + 1; t <= message.length; t++) {
                let activity = message.substring(f, t);
                if (other_activities.includes(activity)) {
                  return memory.list([
                    `mute:activity:${activity}`,
                    `mute:user:${other_user_id}`,
                    `mute:user:${other_user_id}:activity:${activity}`,
                    `mute:user:${other_user_id}:other:${user_id}`
                  ]).then(values => !values.reduce((b1, b2) => b1 || b2, false))
                }
              }
            }
            return false;
          }).then(value => value ? other_user_id : null)
        )
      ).then(promises => Promise.all(promises))
      .then(user_ids => user_ids.filter(user_id => user_id != null))
      .then(user_ids => user_ids.length == 0 ? Promise.resolve() : discord.respond(channel_id, event_id, 'Fyi ' + user_ids.map(user_id => `<@${user_id}>`).join(', ')));
    promises.push(promise);
  }
  
  if (guild_id && message.toLowerCase().split(' ').includes('@activity')) {
    let activities = await memory.get(`activities:current:user:${user_id}`, []);
    let promise = discord.guild_members_list(guild_id)
      .then(members => members
        .map(member => member.user.id)
        .filter(other_user_id => user_id !== other_user_id && !message.includes(other_user_id))
        .map(other_user_id => memory.get(`activities:all:user:${other_user_id }`, [])
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
        )
      ).then(promises => Promise.all(promises))
      .then(user_ids => user_ids.filter(user_id => user_id != null))
      .then(user_ids => user_ids.length == 0 ? Promise.resolve() : discord.respond(channel_id, event_id, 'Fyi (' + activities.join(' ') + ') ' + user_ids.map(user_id => `<@${user_id}>`).join(', ')));
    promises.push(promise);
  }
  
  if (guild_id && (message.toUpperCase().includes('SOS') || message.toUpperCase().includes('S.O.S'))) {
    let activities = await memory.get(`activities:current:user:${user_id}`, []);
    let promise = discord.guild_members_list(guild_id)
      .then(members => members
        .map(member => member.user.id)
        .filter(other_user_id => user_id !== other_user_id && !message.includes(other_user_id ))
        .map(other_user_id => memory.get(`activities:all:user:${other_user_id }`, [])
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
        )
      ).then(promises => Promise.all(promises))
      .then(user_ids => user_ids.filter(user_id => user_id != null))
      .then(user_ids => user_ids.length == 0 ? Promise.resolve() : discord.respond(channel_id, event_id, '**SOS** by ' + `<@${user_id}>` + ' for ' + activities.join(' ') + ' ' + user_ids.map(user_id => `<@${user_id}>`).join(', ')));
    promises.push(promise);
  }
  
  if ((mentioned || Math.random() < 0.3) && message.toLowerCase().includes('joke') && (message.toLowerCase().includes('wow') || message.toLowerCase().includes('world of warcraft'))) {
    let promise = wow.getJoke().then(result => discord.respond(channel_id, event_id, 'Did somebody say \'joke\'? I know a good one: ' + result));
    promises.push(promise);
  } else if ((mentioned || Math.random() < 0.3) && message.toLowerCase().includes('joke')) {
    let promise = curl.request({ hostname: 'icanhazdadjoke.com', headers: {'accept': 'text/plain'} }).then(result => discord.respond(channel_id, event_id, 'Did somebody say \'joke\'? I know a good one: ' + result));
    promises.push(promise);
  }
  
  if ((mentioned || Math.random() < 0.5) && message.toLowerCase().includes('chuck norris')) {
    let promise = curl.request({ hostname: 'api.chucknorris.io', path: '/jokes/random', headers: {'accept': 'text/plain'} }).then(result => discord.respond(channel_id, event_id, result));
    promises.push(promise);
  }
  
  if ((mentioned || Math.random() < 0.5) && message.toLowerCase().includes('ron swanson')) {
    let promise = curl.request({ hostname: 'ron-swanson-quotes.herokuapp.com', path: '/v2/quotes' }).then(result => discord.respond(channel_id, event_id, result[0]));
    promises.push(promise);
  }
  
  let tokens = message.split(' ')
  tokens = tokens
    .map(token => token.endsWith('.') || token.endsWith('!') || token.endsWith('?') ? token.substring(0, token.length - 1) : token)
    .filter(token => token.length > 0);
  for (let i = 0; i < tokens.length; i++) {
    let value = parseFloat(tokens[i]);
    if (isNaN(value)) continue;
    let context = tokens.slice(i + 1, i + 3).map(token => token.toLowerCase());
    let converted_value = NaN;
    let converted_unit = 'metric';
    if ((context.includes('degrees') && context.includes('f')) || context.includes('fahrenheit')) {
      if (context.includes('c') || context.includes('celsius')) continue;
      unit = 'fahrenheit';
      converted_value = (value - 32) * 5/9;
      converted_unit = 'c';
    } else if (context.includes('foot') || context.includes('feet') || context.includes('ft')) {
      unit = 'feet';
      converted_value = value * 0.3048 * 100;
      converted_unit = 'cm';
    } else if (context.includes('inch') || context.includes('inches') || context[0] == 'in') {
      unit = 'inches';
      converted_value = value * 0.0254 * 100;
      converted_unit = 'cm';
    } else if (context.includes('yard') || context.includes('yards') || context.includes('yd') || context.includes('yds')) {
      unit = 'yards';
      converted_value = value * 0.9144;
      converted_unit = 'm';
    } else if (context.includes('mile') || context.includes('miles') || context.includes('mi')) {
      unit = 'miles';
      converted_value = value * 1609.344 / 1000;
      converted_unit = 'km';
    } else if (context.includes('pound') || context.includes('pounds') || context.includes('lb') || context.includes('lbs')) {
      unit = 'pounds';
      converted_value = value * 453.59237 / 1000;
      converted_unit = 'kg';
    } else if (context.includes('ounce') || context.includes('ounces') || context.includes('oz')) {
      unit = 'ounces';
      converted_value = value * 28.349523125;
      converted_unit = 'g';
    } else if (context.includes('stone') || context.includes('stones') || context.includes('st')) {
      unit = 'stones';
      converted_value = value * 6.35029318;
      converted_unit = 'kg';
    } else if (context.includes('gallon') || context.includes('gallons') || context.includes('gal') || context.includes('gals')) {
      unit = 'gallons';
      converted_value = value * 3.785411784;
      converted_unit = 'l';
    } else if (context.includes('pint') || context.includes('pints') || context.includes('pt')) {
      unit = 'pints';
      converted_value = value * 473.176473 / 1000;
      converted_unit = 'l';
    } else {
      continue;
    }
    let promise = discord.respond(channel_id, event_id, `${value} ${unit} are ${converted_value} ${converted_unit} in metric units.`);
    promises.push(promise);
  }
  
  if (guild_id && !mentioned && user_id == process.env.OWNER_DISCORD_USER_ID && false) { // this is super spammy because there is literally an entry for everything, even for "hello"
    let tokens = message.split(' ');
    let needles = [];
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j <= Math.min(i + 5, tokens.length); j++) {
        needles.push(tokens.slice(i, j).join(' '));
      }
    }
    promises.push(Promise.all(needles.map(needle => urban_dictionary.lookup(needle)))
        .then(results => results.filter(result => !!result))
        .then(results => Promise.all(results.map(result => memory.get(`mute:auto:urban_dictionary:guild:${guild_id}:channel:${channel_id}:term:${result.word}`, false).then(muted => muted ? null : result))))
        .then(results => results.filter(result => !!result))
        .then(results => Promise.all(results.map(result => memory.set(`mute:auto:urban_dictionary:guild:${guild_id}:channel:${channel_id}:term:${result.word}`, true, 60 * 60 * 24 * 31).then(() => result))))
        .then(results => Promise.all(results.map(result => discord.respond(channel_id, event_id, `${result.word}: ${result.definition}`))))
      );
  }
  
  if (guild_id && !mentioned) {
    let tokens = message.toLowerCase().split(' ');
    let triggers = [];
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j <= Math.min(i + 5, tokens.length); j++) {
        triggers.push(tokens.slice(i, j).join(' '));
      }
    }
    promises.push(
      memory.list(Array.from(new Set(triggers)).map(trigger => `trigger:guild:${guild_id}:trigger:` + memory.mask(trigger)))
        .then(entries => Promise.all(entries
          .map(entry => entry.value)
          .filter(value => typeof value == 'string' || Math.random() < value.probability)
          .map(value => typeof value == 'string' ? value : value.response)
          .map(value => discord.respond(channel_id, event_id, value))
        ))
    );
  }
  
  if ((mentioned || Math.random() < 0.1) && (message.toLowerCase().includes('hard') || message.toLowerCase().includes('big') || message.toLowerCase().includes('huge') || message.toLowerCase().includes('deep'))) {
    promises.push(discord.respond(channel_id, event_id, 'That\'s what she said!'));
  }
  
  return Promise.all(promises);
}

async function handleCommand(guild_id, channel_id, event_id, user_id, user_name, message, referenced_message_id, me) {
  if (message.length == 0) {
    return Promise.resolve();
    
  } else if (message === 'ping') {
    return discord.respond(channel_id, event_id, 'pong');
    
  } else if (message.startsWith('echo ')) {
    return discord.respond(channel_id, event_id, message.split(' ').slice(1).join(' '));
  
  } else if (message === 'fail') {
    if (user_id != process.env.OWNER_DISCORD_USER_ID) {
      return reactNotOK(channel_id, event_id);
    }
    throw new Error('This is a simulated error for production testing!');
    
  } else if (message === 'dump memory' || message.startsWith('dump memory ')) {
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
  
  } else if (message === 'show memory' || message.startsWith('show memory ')) {
    if (user_id != process.env.OWNER_DISCORD_USER_ID) {
      return reactNotOK(channel_id, event_id);
    }
    let filter = message.split(' ').slice(2);
    return memory.toString(true,
        filter.filter(element => !element.startsWith('!')),
        filter.filter(element => element.startsWith('!')).map(element => element.substring(1))
      )
      .then(result => discord.respond(channel_id, event_id, result));
    
  } else if (message.startsWith('clear memory')) {
    if (user_id != process.env.OWNER_DISCORD_USER_ID) {
      return reactNotOK(channel_id, event_id);
    }
    return memory.unset(message.split(' ').slice(2).join(' ')).then(() => reactOK(channel_id, event_id));
    
  } else if (message.startsWith("insert memory ")) {
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
    
  } else if (message == 'help') {
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
    return identity.getPublicURL()
        .then(url => discord.respond(channel_id, event_id, ('' + fs.readFileSync('./help.txt'))
          .replace(/\$\{about_instruction\}/g, 'Use \'${name} about\'')
          .replace(/\$\{name\}/g, `<@${me.id}>`)
          .replace(/\$\{notification_role\}/g, notification_role_name)
          + '\nUse ' + url + '/help to share this help with others outside your discord server.'
        )
      );
    
  } else if (message == 'about') {
    return identity.getPublicURL()
      .then(url => discord.respond(channel_id, event_id,  ('' + fs.readFileSync('./about.txt'))
          .replace(/\$\{name\}/g, `<@${me.id}>`)
          .replace(/\$\{version\}/g, process.env.SERVICE_VERSION)
          .replace(/\$\{link_code\}/g, url + '/code')
          .replace(/\$\{link_discord_add\}/g, url + '/deploy')
          .replace(/\$\{link_monitoring\}/g, url + '/monitoring')
          + '\nUse ' + url + '/about to share this about with others outside your discord server.'
        )
      );
    
  } else if (message === 'good bot') {
    return discord.react(channel_id, event_id, '👍');
    
  } else if (message === 'bad bot') {
    return discord.react(channel_id, event_id, '😢');
    
  } else if (message.startsWith('command start ')) {
    return memory.set(`command:user:${user_id}`, message.split(' ').slice(2).join(' '), 60 * 60)
      .then(() => reactOK(channel_id, event_id));
    
  } else if (message.startsWith('command continue ')) {
    return memory.get(`command:user:${user_id}`, '')
      .then(command => memory.set(`command:user:${user_id}`, command + message.split(' ').slice(2).join(' '), 60 * 60))
      .then(() => reactOK(channel_id, event_id));
    
  } else if (message === 'command execute') {
    return memory.consume(`command:user:${user_id}`, null)
      .then(command => command ?
        handleCommand(guild_id, channel_id, event_id, user_id, user_name, command, me) :
        reactNotOK(channel_id, event_id)
      );
  
  } else if (message.startsWith('play ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await features.isActive(guild_id, 'player')) return respondNeedsFeatureActive(channel_id, event_id, 'player', 'play music');
    message = message.split(' ').slice(1).join(' ');
    let shuffle = message.startsWith('shuffled ');
    if (shuffle) {
      message = message.split(' ').slice(1).join(' ');
    }
    let search_string = null;
    let voice_channel_id = null;
    if (message.startsWith('in ')) {
      let channel_name = message.split(' ')[1];
      voice_channel_id = await discord.guild_channels_list(guild_id).then(channels => channels.find(channel => channel.name == channel_name)).then(channel => channel?.id); 
      if (!voice_channel_id) return respond(channel_id, event_id, 'I cannot find the channel ' + channel_name + '!');
      search_string = message.split(' ').slice(2).join(' ');
    } else {
      let voice_state = await memory.get(`voice_channel:user:${user_id}`);
      if (!voice_state || voice_state.guild_id != guild_id) return respond(channel_id, event_id, 'I do not know which channel to use. Either join a voice channel first or tell me explicitly which channel to use!');
      voice_channel_id = voice_state.channel_id;
      search_string = message;
    }

    let timer = setInterval(() => discord.trigger_typing_indicator(channel_id), 1000 * 10);
    return discord.trigger_typing_indicator(channel_id)
      .then(() => search_string === 'next' ? player.playNext(guild_id, voice_channel_id) : player.play(guild_id, voice_channel_id, search_string))
      .then(() => reactOK(channel_id, event_id))
      .catch(error => discord.respond(channel_id, event_id, error.message))
      .finally(() => clearInterval(timer));
      
  } else if (message === "stop") {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await features.isActive(guild_id, 'player')) return respondNeedsFeatureActive(channel_id, event_id, 'player', 'play music');
    return player.stop(guild_id).then(command => reactOK(channel_id, event_id).then(() => command));
    
  } else if (message === "pause") {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await features.isActive(guild_id, 'player')) return respondNeedsFeatureActive(channel_id, event_id, 'player', 'play music');
    return player.pause(guild_id).then(() => reactOK(channel_id, event_id));
    
  } else if (message === "resume") {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await features.isActive(guild_id, 'player')) return respondNeedsFeatureActive(channel_id, event_id, 'player', 'play music');
    return player.resume(guild_id).then(() => reactOK(channel_id, event_id));
    
  } else if (message.startsWith('queue ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await features.isActive(guild_id, 'player')) return respondNeedsFeatureActive(channel_id, event_id, 'player', 'play music');
    return player.appendToQueue(guild_id, message.split(' ').slice(1).join(' ')).then(() => reactOK(channel_id, event_id))
      
  } else if (message === 'shuffle queue') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await features.isActive(guild_id, 'player')) return respondNeedsFeatureActive(channel_id, event_id, 'player', 'play music');
    return player.shuffleQueue(guild_id).then(() => reactOK(channel_id, event_id));
    
  } else if (message === 'clear queue') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await features.isActive(guild_id, 'player')) return respondNeedsFeatureActive(channel_id, event_id, 'player', 'play music');
    return player.clearQueue(guild_id).then(() => reactOK(channel_id, event_id));
    
  } else if (message === 'show queue') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await features.isActive(guild_id, 'player')) return respondNeedsFeatureActive(channel_id, event_id, 'player', 'play music');
    let queue = await player.getQueue(guild_id);
    if (queue.length == 0) {
      return discord.respond(channel_id, event_id, 'The queue is empty');
    }
    let buffer = '';
    for (var index = 0; index < queue.length && index < 5; index++) {
      if (index > 0) {
        buffer += ', ';
      }
      buffer += '**' + queue[index] + '**';
    }
    return discord.respond(channel_id, event_id, 'The queue consists of ' + buffer + ' and ' + Math.max(0, queue.length - 5) + ' more...');
  
  } else if (message.startsWith('add repeating event ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) {
      return discord.respond(channel_id, event_id, 'I can only add a repeating event via a text channel within a guild or while you are in a voice channel. Otherwise I do not know which guild to schedule this event for.');
    }
    if (!await features.isActive(guild_id, 'repeating events')) {
      return respondNeedsFeatureActive(channel_id, event_id, 'repeating events', 'add a repeating event');
    }
    if (!await discord.guild_member_has_permission(guild_id, user_id, 'MANAGE_EVENTS')) {
      return discord.respond(channel_id, event_id, 'You need the \'Manage Events\' permission to add repeating events.')
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
      await discord.respond(channel_id, event_id, 'If you choose an event name that is also the same as a game, I will be able to find and notify potentially interested players automatically. I will schedule the event anyway. You can remove and re-create it at any time.');
    }
    
    return memory.set(`repeating_events:config:guild:${guild_id}`, event_configs).then(() => reactOK(channel_id, event_id));
    
  } else if (message.startsWith('remove repeating event ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) {
      return discord.respond(channel_id, event_id, 'I can only removea repeating event via a text channel within a guild or while you are in a voice channel. Otherwise I do not know which guild to remove this event for.');
    }
    if (!await features.isActive(guild_id, 'repeating events')) {
      return respondNeedsFeatureActive(channel_id, event_id, 'repeating events', 'remove a repeating event');
    }
    if (!await discord.guild_member_has_permission(guild_id, user_id, 'MANAGE_EVENTS')) {
      return discord.respond(channel_id, event_id, 'You need the \'Manage Events\' permission to add or remove repeating events.')
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
    
  } else if (message.startsWith('remember birthday ')) {
    let input = message.substring('remember birthday '.length).split(' ');
    let username = input[0];
    let day = parseInt(input[1].substring(0, input[1].indexOf('.')));
    let month = parseInt(input[1].substring(input[1].indexOf('.') + 1, input[1].length));
    for (let guild of await discord.guilds_list()) {
      for (let member of await discord.guild_members_list(guild.id)) {
        if (member.user.username === username || (member.nick ? member.nick === username : false)) {
          await memory.set(`birthday:user:${member.user.id}`, { day: day, month: month });
          return reactOK(channel_id, event_id);
        }
      }
    }
    return reactNotOK(channel_id, event_id);
    
  } else if (message.startsWith('notify me for ')) {
    let activity = message.substring('notify me for '.length).trim();
    return memory.set(`notify:user:${user_id}:activity:${activity}`, true).then(() => reactOK(channel_id, event_id));
  } else if (message.startsWith('stop notifying me for ')) {
    let activity = message.substring('stop notifying me for '.length).trim();
    return memory.unset(`notify:user:${user_id}:activity:${activity}`).then(() => reactOK(channel_id, event_id));
    
  /*
  } else if (message.toLowerCase().startsWith('what') || message.toLowerCase().startsWith('how') || message.toLowerCase().startsWith('who') || message.toLowerCase().startsWith('when') || message.toLowerCase().startsWith('where') || message.trim().endsWith('?')) {
    let link = 'https://letmegooglethat.com/?q=' + message.trim().replace(/ /g, '+');
    return discord.respond(channel_id, event_id, link);
  */
    
  } else if (message.toLowerCase().startsWith("hint") || message.toLowerCase().startsWith("info") || message.toLowerCase().startsWith("information")) {
    let activity = message.split(' ').slice(1).join(' ');
    return games.getActivityHint(activity, null, null, user_id)
      .then(hint => hint != null ? discord.respond(channel_id, event_id, hint.text) : reactNotOK(channel_id, event_id));
      
  } else if (message.toLowerCase().startsWith('remind ')) {
    let tokens = message.split(' ').filter(token => token.length > 0);
    let index = 1;
    let to_name = tokens[index++];
    // if (to_name != 'me') return discord.respond(channel_id, event_id, 'I can only remind yourself for now.');
    let to_id;
    if (to_name == 'me') to_id = user_id;
    else {
      guild_id = guild_id ?? await resolveGuildID(user_id);
      if (!guild_id) return discord.respond(channel_id, event_id, 'I do not know who you mean.');
      if (to_name.startsWith('<@') && to_name.endsWith('>')) {
        if (to_name.startsWith('!')) to_name = to_name.substring(1);
        to_id = to_name.substring(2, to_name.length - 1);
      } else if (to_name.startsWith('<@&')) {
        return discord.respond(channel_id, event_id, 'I can only remind individual users, not roles.')
      } else {
        to_id = await discord.guild_members_list(guild_id)
          .then(members => members.filter(member => member.user.username == to_name || (member.nick && member.nick == to_name)))
          .then(members => members.length > 0 ? members[0].user.id : undefined);
        if (!to_id) return discord.respond(channel_id, event_id, 'I do not know ' + to_name + '.');
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
      if (isNaN(count)) return discord.respond(channel_id, event_id, 'I do not know how much ' + count + ' is.');
      if (!unit_string.endsWith('s')) unit_string += 's';
      switch (unit_string) {
        case 'minutes': next = Date.now() + 1000 * 60 * count; break;
        case 'hours': next = Date.now() + 1000 * 60 * 60 * count; break;
        case 'days': next = Date.now() + 1000 * 60 * 60 * 24 * count; break;
        case 'weeks': next = Date.now() + 1000 * 60 * 60 * 24 * 7 * count; break;
        case 'months': next = Date.now() + 1000 * 60 * 60 * 24 * 30 * count; break;
        case 'years': next = Date.now() + 1000 * 60 * 60 * 24 * 365 * count; break;
        default: return discord.respond(channel_id, event_id, 'I do not know ' + unit_string + '.');
      }
    } else if (next_string == 'on') {
      let date_string = tokens[index++];
      let split = date_string.indexOf('.');
      if (split < 0) return discord.respond(channel_id, event_id, 'I do not understand the date ' + date_string + '.');
      let day = parseInt(date_string.substring(0, split));
      let month = parseInt(date_string.substring(split + 1)) - 1;
      if (isNaN(day) || isNaN(month)) return discord.respond(channel_id, event_id, 'I do not understand the date ' + date_string + '.');
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
      from_username: to_name == 'me' ? 'You' : user_name,
      from_id: user_id,
      to_username: to_name == 'me' ? 'you' : to_name,
      to_id: to_id
    };
    return memory.get(`reminders:user:${to_id}`, [])
      .then(reminders => memory.set(`reminders:user:${to_id}`, reminders.concat([reminder])))
      .then(() => reactOK(channel_id, event_id))
      
  } else if (message.startsWith('random ')) {
    message = message.split(' ').slice(1).join(' ');
    if (message.includes(';')) {
      let tokens = message.split(';').map(token => token.trim());
      return discord.respond(channel_id, event_id, tokens[Math.floor(Math.random() * tokens.length)]);
    } else {
      let tokens = message.split(' ');
      if (tokens.length == 1 && !isNaN(tokens[0])) {
        return discord.respond(channel_id, event_id, '' + Math.floor(Math.random() * parseInt(tokens[0])));
      } else if (tokens.length == 2 && !isNaN(tokens[0]) && !isNaN(tokens[1])) {
        return discord.respond(channel_id, event_id, '' + Math.floor(parseInt(tokens[0]) + Math.random() * (parseInt(tokens[1]) - parseInt(tokens[0]))));
      } else {
        return discord.respond(channel_id, event_id, tokens[Math.floor(Math.random() * tokens.length)]);
      }
    }
  
  } else if (message.startsWith('create alias ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(channel_id, event_id, 'create an alias');
    let name = message.split(' ')[2];
    let command = message.split(' ').slice(3).join(' ');
    return memory.set(`alias:` + memory.mask(name) + `:guild:${guild_id}`, command).then(() => reactOK(channel_id, event_id));
    
  } else if (message.startsWith('remove alias ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(channel_id, event_id, 'remove an alias');
    let name = message.split(' ')[2];
    return memory.unset(`alias:` + memory.mask(name) + `:guild:${guild_id}`).then(() => reactOK(channel_id, event_id));

  } else if (message.startsWith('tournament create ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(channel_id, event_id);
    if (!await features.isActive(guild_id, 'tournament')) return respondNeedsFeatureActive(channel_id, event_id, 'tournament', 'create a tournament');
    message = message.split(' ').slice(2).join(' ');
    let tokens = message.split(',');
    let name = tokens[0].trim();
    let category = tokens[1].trim();
    let channel = tokens[2].trim();
    let game_masters = tokens[3].split(';').map(mention => discord.parse_mention(mention)).filter(user => !!user);
    let team_size = parseInt(tokens[4].trim());
    let locations = tokens[5].split(';').map(location => location.trim());
    let length = parseInt(tokens[6].trim());
    return tournament.create(guild_id, name, category, channel, game_masters, team_size, locations, length)
      .then(ok => ok ? reactOK(channel_id, event_id) : reactNotOK(channel_id, event_id));
  
  } else if (message.startsWith('tournament register ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    message = message.split(' ').slice(2).join(' ');
    let player = message === 'me' ? user_id : discord.parse_mention(message);
    if (!player) return reactNotOK(channel_id, event_id);
    return tournament.register_player(guild_id, user_id, player)
      .then(ok => ok ? reactOK(channel_id, event_id) : reactNotOK(channel_id, event_id));

  } else if (message.startsWith('tournament unregister ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    message = message.split(' ').slice(2).join(' ');
    let player = message === 'me' ? user_id : discord.parse_mention(message);
    if (!player) return reactNotOK(channel_id, event_id);
    return tournament.unregister_player(guild_id, user_id, player)
      .then(ok => ok ? reactOK(channel_id, event_id) : reactNotOK(channel_id, event_id));
      
  } else if (message === 'tournament announce') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    return tournament.announce(guild_id, user_id)
      .then(ok => ok ? reactOK(channel_id, event_id) : reactNotOK(channel_id, event_id));
  
  } else if (message === 'tournament show') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    return tournament.show(guild_id, user_id).then(string => discord.respond(channel_id, event_id, string));

  } else if (message.startsWith('tournament define team ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    message = message.split(' ').slice(3).join(' ');
    let split = message.indexOf(':');
    if (split < 0) return discord.respond(channel_id, event_id, 'Team name and list of members must be split by \':\'.');
    let name = message.substring(0, split);
    let players = message.substring(split + 1, message.length).split(' ').filter(token => token.length > 0).map(mention => discord.parse_mention(mention));
    if (name.length == 0 || players.some(player => !player)) return reactNotOK(channel_id, event_id);
    return tournament.define_team(guild_id, user_id, name, players)
      .then(ok => ok ? reactOK(channel_id, event_id) : reactNotOK(channel_id, event_id));
    
  } else if (message.startsWith('tournament dissolve team ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    message = message.split(' ').slice(3).join(' ');
    let id = parseInt(message.trim());
    if (isNaN(id)) return discord.respond(channel_id, event_id, 'You must refer to a team by its id.');
    return tournament.dissolve_team(guild_id, user_id, id)
      .then(ok => ok ? reactOK(channel_id, event_id) : reactNotOK(channel_id, event_id));
        
  } else if (message.startsWith('tournament replace ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    message = message.split(' ').slice(2).join(' ');
    let players = message.split(' ').filter(token => token.length > 0).map(mention => discord.parse_mention(mention));
    if (players.length != 2) return discord.respond(channel_id, event_id, 'You must specify exactly two players.');
    return tournament.replace_player(guild_id, user_id, players[0], players[1])
      .then(ok => ok ? reactOK(channel_id, event_id) : reactNotOK(channel_id, event_id));
    
  } else if (message === 'tournament prepare') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    return tournament.prepare(guild_id, user_id)
      .then(ok => ok ? reactOK(channel_id, event_id) : reactNotOK(channel_id, event_id));
    
  } else if (message === 'tournament start') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    return tournament.start(guild_id, user_id)
      .then(ok => ok ? reactOK(channel_id, event_id) : reactNotOK(channel_id, event_id));
    
  } else if (message.startsWith('tournament start match ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    message = message.split(' ').slice(3).join(' ');
    let match_id = parseInt(message.trim());
    if (isNaN(match_id)) return discord.respond(channel_id, event_id, 'You must refer to the match by its id.');
    return tournament.match_started(guild_id, user_id, match_id)
      .then(ok => ok ? reactOK(channel_id, event_id) : reactNotOK(channel_id, event_id));
      
  } else if (message.startsWith('tournament abort match ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    message = message.split(' ').slice(3).join(' ');
    let match_id = parseInt(message.trim());
    if (isNaN(match_id)) return discord.respond(channel_id, event_id, 'You must refer to the match by its id.');
    return tournament.match_aborted(guild_id, user_id, match_id)
      .then(ok => ok ? reactOK(channel_id, event_id) : reactNotOK(channel_id, event_id));

  } else if (message.startsWith('tournament complete match ')) {
    message = message.split(' ').slice(3).join(' ');
    let tokens = message.split(' ');
    let ids = tokens.filter(token => token.length > 0).map(token => parseInt(token));
    let match_id = ids[0];
    let winner = ids[1];
    if (isNaN(match_id) || isNaN(winner)) return discord.respond(channel_id, event_id, 'You must refer to the match and the team by its id.');
    return tournament.match_completed(guild_id, user_id, match_id, winner)
      .then(ok => ok ? reactOK(channel_id, event_id) : reactNotOK(channel_id, event_id));
      
  } else if (message.startsWith('configure League of Legends ')) {
    message = message.substring('configure League of Legends '.length);
    let configs = message.split(';')
      .map(config => config.trim())
      .map(config => { return { server: config.substring(0, config.indexOf(' ')).trim(), summoner: config.substring(config.indexOf(' ') + 1, config.length).trim() }; });
    if (configs.length == 0 || configs.some(config => config.server.length == 0 || config.summoner.length == 0)) {
      return reactNotOK(channel_id, event_id);
    }
    let summoners = await Promise.all(configs.map(config => lol.getSummoner(config.server, config.summoner)));
    for (let i = 0; i < configs.length; i++) {
      if (!summoners[i]) {
        return discord.respond(channel_id, event_id, `Summoner ${configs[i].summoner} does not exist on server ${configs[i].server}. Please double check the spelling and try again!`);
      }
    }
    return memory.set('activity_hint_config:activity:League of Legends:user:' + user_id, configs)
      .then(() => games.getActivityHint('League of Legends', null, null, user_id))
      .then(hint => hint ? discord.respond(channel_id, event_id, hint.text) : reactOK(channel_id, event_id));
      
  } else if (message.startsWith('add trigger ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(channel_id, event_id, 'add a trigger');
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
    
  } else if (message.startsWith('remove trigger ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(channel_id, event_id, 'remove a trigger');
    message = message.substring('remove trigger '.length);
    trigger = message.trim().toLowerCase();
    return memory.unset(`trigger:guild:${guild_id}:trigger:` + memory.mask(trigger))
      .then(() => reactOK(channel_id, event_id));
  
  } else if (message.startsWith('define ')) {
    message = message.substring('define '.length).trim();
    if (message.length == 0) return reactNotOK(channel_id, event_id);
    return urban_dictionary.lookup(message)
      .then(result => discord.respond(channel_id, event_id, result ? `${result.word}: ${result.definition} (${result.permalink})` : `No entry found for ${message}.`));
  
  } else if (message.startsWith('activate ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(channel_id, event_id, 'activate a feature');
    let feature = message.split(' ').slice(1).join(' ');
    if (!features.list().includes(feature)) return reactNotOK(channel_id, event_id);
    let needed_permissions = await Promise.all(permissions.required([ feature ]).map(permission => discord.guild_member_has_permission(guild_id, me.id, permission).then(has => has ? null : permission))).then(names => names.filter(name => !!name));
    if (needed_permissions.length > 0) {
      return discord.respond(channel_id, event_id, `Before I can activate ${feature}, pls grant me the following permissions (via Server Settings -> Roles -> ${me.username} -> Permissions): ` + needed_permissions.map(name => `**${name}**`).join(', ') + '.');
    }
    return features.setActive(guild_id, feature, true).then(() => reactOK(channel_id, event_id));
    
  } else if (message.startsWith('deactivate ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(channel_id, event_id, 'deactivate a feature');
    let feature = message.split(' ').slice(1).join(' ');
    if (!features.list().includes(feature)) return reactNotOK(channel_id, event_id);
    return features.setActive(guild_id, feature, false).then(() => reactOK(channel_id, event_id));
    
  } else if (message == 'raid lockdown') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(channel_id, event_id, 'lock down the server');
    if (!await features.isActive(guild_id, 'raid protection')) return respondNeedsFeatureActive(channel_id, event_id, 'raid protection', 'lock down the server');
    return raid_protection.lockdown(guild_id).then(() => reactOK(channel_id, event_id));
    
  } else if (message == 'raid all clear') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(channel_id, event_id, 'lift lockdown the server');
    return raid_protection.all_clear(guild_id).then(() => reactOK(channel_id, event_id));

  } else if (message.startsWith('subscribe to ')) {
    let tokens = message.split(' ').slice(2).filter(token => token.length > 0);
    let link = tokens[0];
    let filter = tokens.slice(1).join(' ');
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!link) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(channel_id, event_id, 'add subscription');
    return subscriptions.add(guild_id, channel_id, link, filter)
      .then(() => reactOK(channel_id, event_id))
      .catch(error => discord.respond(channel_id, event_id, error.message));

  } else if (message.startsWith('unsubscribe from ')) {
    let tokens = message.split(' ').slice(2).filter(token => token.length > 0);
    let link = tokens[0];
    let filter = tokens.slice(1).join(' ');
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!link) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(channel_id, event_id, 'remove subscription');
    return subscriptions.remove(guild_id, channel_id, link, filter)
      .then(() => reactOK(channel_id, event_id))
      .catch(error => discord.respond(channel_id, event_id, error.message));

  } else if (message == 'automatic roles list' || message == 'automatic roles list rules') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(channel_id, event_id, 'auto-set role');
    if (!await features.isActive(guild_id, 'role management')) return respondNeedsFeatureActive(channel_id, event_id, 'role management', 'auto-manage roles');
    return role_management.to_string(guild_id).then(string => discord.respond(channel_id, event_id, string));

  } else if (message.startsWith('automatic roles create rule ')) {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(channel_id, event_id, 'auto-set role');
    if (!await features.isActive(guild_id, 'role management')) return respondNeedsFeatureActive(channel_id, event_id, 'role management', 'auto-manage roles');
    message = message.split(' ').slice(4).join(' ');
    return role_management.add_new_rule(guild_id, message)
      .then(() => reactOK(channel_id, event_id))
      .catch(error => discord.respond(channel_id, event_id, error.message));
    
  } else if (message == 'automatic roles update') {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (!guild_id) return reactNotOK(channel_id, event_id);
    if (!await hasMasterPermission(guild_id, user_id)) return respondNeedsMasterPermission(channel_id, event_id, 'auto-set role');
    if (!await features.isActive(guild_id, 'role management')) return respondNeedsFeatureActive(channel_id, event_id, 'role management', 'auto-manage roles');
    return role_management.update_all(guild_id).then(() => reactOK(channel_id, event_id));
  
  } else if (await delayed_memory.materialize(`response:` + memory.mask(message) + `:user:${user_id}`)) {
    return reactOK(channel_id, event_id);

  } else {
    guild_id = guild_id ?? await resolveGuildID(user_id);
    if (guild_id) {
      let tokens = message.split(' ');
      let alias = await memory.get(`alias:` + memory.mask(tokens[0]) + `:guild:${guild_id}`, undefined);
      if (alias) {
        message = (alias + ' ' + message.substring(tokens[0].length + 1)).trim();
        return handleCommand(guild_id, channel_id, event_id, user_id, user_name, message, me);
      }
    }
    return discord.respond(channel_id, event_id, `I\'m sorry, I do not understand. Use \'<@${me.id}> help\' to learn more.`);
  }
}

async function reactOK(channel_id, event_id) {
  return discord.react(channel_id, event_id, '👍');
}

async function reactNotOK(channel_id, event_id) {
  return discord.react(channel_id, event_id, '👎');
}

async function hasMasterPermission(guild_id, user_id) {
  return discord.guild_member_has_permission(guild_id, user_id, 'MANAGE_SERVER');
}

async function respondNeedsMasterPermission(channel_id, event_id, action) {
  return discord.respond(channel_id, event_id, `You need the permission 'Manage Server' to ${action}.`);
}

async function respondNeedsFeatureActive(channel_id, event_id, feature, action) {
  return discord.me().then(me => discord.respond(channel_id, event_id, `The feature ${feature} needs to be active to ${action}. Use '<@${me.id}> activate ${feature}' to turn it on.`));
}

async function resolveGuildID(user_id) {
  return memory.get(`voice_channel:user:${user_id}`, null).then(info => info ? info.guild_id : null);
}

module.exports = { handle }
