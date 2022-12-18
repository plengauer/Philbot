const process = require('process');
const memory = require('../../../shared/memory.js');
const memory_health = require('../../../shared/memory_health.js');
const delayed_memory = require('../../../shared/delayed_memory.js');
const discord = require('../../../shared/discord.js');
const datefinder = require('../../../shared/datefinder.js');
const permissions = require('../../../shared/permissions.js');
const features = require('../../../shared/features.js');

const mute_ttl = 60 * 60 * 24 * 7 * 4;
const scheduling_distance = 1000 * 60 * 60 * 24 * 4;

async function handle() {
  return Promise.all([
    discord.guilds_list().then(guilds => Promise.all(guilds.map(guild => handleGuild(guild)))),
    sendReminders(),
  ]).then(() => memory.clean())
  .then(() => undefined)
}

async function handleGuild(guild) {
  return features.isActive(guild.id, 'repeating events').then(active => active ?
    memory.get(`repeating_events:config:guild:${guild.id}`, [])
      .then(event_configs => Promise.all(event_configs.map(event_config => tryScheduleEvent(guild, guild_details_promise, members_promise, events_promise, event_config)))) :
    Promise.resolve());
}

async function tryScheduleEvent(guild, guild_details, members, events, event_config) {
  let now = new Date();
  if ((await memory.list([ `mute:event:guild:${guild.id}:name:${event_config.name}`, `mute:auto:event:guild:${guild.id}:name:${event_config.name}:schedule:${event_config.schedule.day}.${event_config.schedule.hour}.${event_config.schedule.minute}` ])).reduce((e1, e2) => e1.value || e2.value, false)) {
    return Promise.resolve();
  }
  
  let scheduled_start = await datefinder.findNext(now, event_config.schedule.day, event_config.schedule.hour, event_config.schedule.minute, event_config.schedule.timezone);
  let distance = scheduled_start.getTime() - now.getTime();
  if (distance > scheduling_distance) { 
    return Promise.resolve();
  }
  // %Y-%m-%dT%H:%M:%S
  let scheduled_start_string = ''
          + scheduled_start.getUTCFullYear()
    + '-' + ((scheduled_start.getUTCMonth() + 1) < 10 ? '0' : '') + (scheduled_start.getUTCMonth() + 1)
    + '-' + (scheduled_start.getUTCDate() < 10 ? '0' : '') + scheduled_start.getUTCDate()
    + 'T' + (scheduled_start.getUTCHours() < 10 ? '0' : '') + scheduled_start.getUTCHours()
    + ':' + (scheduled_start.getUTCMinutes() < 10 ? '0' : '') + scheduled_start.getUTCMinutes()
    + ':00+00:00';
  
  let found = false;
  for (let event of events) {
    found = found || ((!event_config.name || event.name === event_config.name) && event.scheduled_start_time == scheduled_start_string);
  }
  if (found) {
    return Promise.resolve();
  }
  
  await memory.set(`mute:auto:event:guild:${guild.id}:name:${event_config.name}:schedule:${event_config.schedule.day}.${event_config.schedule.hour}.${event_config.schedule.minute}`, true, scheduling_distance / 1000);
  
  if (Math.random() > event_config.probability) {
    return Promise.resolve();
  }
  
  if (!event_config.name) {
    let activities = await memory.list(members.map(member => `activities:all:user:${member.user.id}`))
      .then(entries => entries.map(entry => entry.value))
      .then(activities => activities.flatMap(a => a))
      .then(activities => {
        let result = {};
        for (let activity of activities) {
          if (!result[activity]) {
            result[activity] = 0;
          }
          result[activity] = result[activity] + 1;
        }
        return result;
      });
    let bag = [];
    for (let activity in activities) {
      if (activities[activity] >= 2) {
        bag.push(activity);
      }
    }
    if (bag.length == 0) {
      return Promise.resolve();
    }
    event_config.name = bag[Math.floor(Math.random() * bag.length)];
    // override
    for (let channel of await discord.guild_channels_list(guild_id)) {
      if (channel.name === event_config.name) {
        event_config.channel_id = channel.id;
        break;
      }
    }
  } else if (!event_config.channel_id) {
    for (let channel of await discord.guild_channels_list(guild_id)) {
      if (channel.name === event_config.name) {
        event_config.channel_id = channel.id;
        break;
      }
    }
  }
  
  if (!event_config.name || !event_config.channel_id) {
    return Promise.resolve();
  }
  
  let event = await discord.scheduledevent_create(guild.id, event_config.channel_id, event_config.name, event_config.description, scheduled_start_string);
  
  if (await memory.get(`mute:activity:${event_config.name}`, false)) {
    return Promise.resolve();
  }
  
  let promises = [];
  
      
  let interestedPromises = members.map(member => Promise.all([
      memory.get(`mute:user:${member.user.id}`, false),
      memory.get(`mute:user:${member.user.id}:activity:${event_config.name}`, false),
      memory.get(`activities:all:user:${member.user.id}`, []).then(activities => {
        let text = event_config.name + '\n' + event_config.description;
        for (let f = 0; f < text.length; f++) {
          for (let t = f + 1; t <= text.length; t++) {
            if (activities.includes(text.substring(f, t))) return false;
          }
        }
        return true;
      })
    ]).then(values => values.some(value => value) ? null : member));
  let interested = [];
  for (let interestedPromise of interestedPromises) {
    let member = await interestedPromise;
    if (!member) continue;
    interested.push(member);
    promises.push(delayed_memory.set(`response:` + memory.mask(`mute for me`) + `:user:${member.user.id}`, `mute:user:${member.user.id}`, true, mute_ttl));
    promises.push(delayed_memory.set(`response:` + memory.mask(`mute for ${event_config.name}`) + `:user:${member.user.id}`, `mute:user:${member.user.id}:activity:${event_config.name}`, true, mute_ttl));
  }
  
  let link = `https://discord.com/events/${guild.id}/${event.id}`;
  if (await memory.get(`scheduled_events:post_public:guild:${guild.id}`, true)) {
    let mentions = '';
    if (await memory.get(`scheduled_events:post_public:mentions:guild:${guild.id}`, false) && interested.length <= 15) {
      for (let member of interested) {
        if (mentions.length > 0) {
          mentions += ', ';
        }
        mentions += '<@' + member.user.id + '>';
      }
    }
    promises.push(
      discord.post({
        channel_id: guild_details.system_channel_id,
        content: `I\'ve scheduled a new event, **${event_config.name}**: ${link}. Join if you can. ` + (mentions.length > 0 ? (` (fyi ${mentions})`) : '')
      })
    );
  }
  if (await memory.get(`scheduled_events:post_dm:guild:${guild.id}`, true)) {
    for (let member of interested) {
      promises.push(discord.try_dms(member.user.id,
          `There is a new event you might be interested in: ${link}. Respond with "mute for me" or "mute for ${event_config.name}" if you want me to stop notifying you for a while.`
        )
      );
    }
  }
  return Promise.all(promises);
}

async function verifyPermissions(guild_id) {
  let required = await Promise.all(features.list().map(name => features.isActive(guild_id, name).then(on => on ? name : null)))
    .then(names => permissions.required(names.filter(name => !!name)));
  
  let me = await discord.me();
  let members = await discord.guild_members_list(guild_id);
  let roles = await discord.guild_roles_list(guild_id);
  
  let my_role_ids = Array.from(new Set(members.filter(member => member.user.id == me.id).map(member => member.roles)[0].concat([ guild_id ])));
  let my_roles = roles.filter(role => my_role_ids.includes(role.id));
  let my_role = roles.filter(role => role.name == me.username)[0];
  
  let missing = [];
  let unnecessary = [];
  for (let permission of permissions.all()) {
    let needs = required.includes(permission);
    let has = permissions.decompile(my_role.permissions).includes(permission);
    if (needs && has) ; // nothing to do
    else if (needs && !has) missing.push(permission);
    else if (!needs && has) unnecessary.push(permission);
    else ; // nothing to do
  }
  
  if (missing.length == 0 && unnecessary.length == 0) return;
  
  console.log('Permissions for ' + guild_id + ': + ' + missing.join(',') + '; - ' + unnecessary.join(','));
  let guild = await discord.guild_retrieve(guild_id);
  let manage_roles_members = await discord.guild_members_list_with_permission(guild_id, 'MANAGE_ROLES');
  manage_roles_members = manage_roles_members.filter(member => Math.random() < 1.0 / manage_roles_members.length); // only send to a few to not annoy too much
  if (missing.length > 0) {
    return Promise.all(manage_roles_members.map(manage_roles_member => discord.try_dms(manage_roles_member.user.id, `Hi ${manage_roles_member.nick ?? manage_roles_member.user.username}, I'm **missing** some crucial **permissions** for ${guild.name} to do my work properly. Please grant me the following additional permissions (via Server Settings -> Roles -> ${my_role.name} -> Permissions): ` + missing.map(p => `**${p}**`).join(', ') + '.')));
  } else if (unnecessary.length > 0) {
    // in theory that shouldnt be an else if, but lets not be too annoying
    return Promise.all(manage_roles_members.map(manage_roles_member => discord.try_dms(manage_roles_member.user.id, `Hi ${manage_roles_member.nick ?? manage_roles_member.user.username}, your privacy and security is important to me. I have some **permissions** for ${guild.name} that I **do not need**. Please drop the following permissions for me (via Server Settings -> Roles -> ${my_role.name} -> Permissions): ` + unnecessary.map(p => `**${p}**`).join(', ') + '.')));
  }
}

async function sendBirthdayGreetings() {
  let now = new Date();
  return discord.users_list()
    .then(users => users
      .map(user => user.id)
      .map(user_id => memory.get(`birthday:user:${user_id}`, null)
        .then(birthday => {
          if (birthday && birthday.month == now.getUTCMonth() + 1 && birthday.day == now.getUTCDate()) {
            return discord.try_dms(user_id, "Happy Birthday 🎂");
          } else {
            return Promise.resolve();
          }
        })
      )
    ).then(results => Promise.all(results));
}

async function sendReminders() {
  return discord.users_list()
    .then(users => users.map(user => user.id).map(user_id => sendRemindersForUser(user_id)))
    .then(results => Promise.all(results));
}

async function sendRemindersForUser(user_id) {
  let now = new Date();
  let reminders = await memory.get(`reminders:user:${user_id}`, []);
  let futureReminders = [];
  let dirty = false;
  
  for (let reminder of reminders) {
    if (reminder.next < now.getTime()) {
      if (!reminder.text.endsWith('.') && !reminder.text.endsWith('?') && !reminder.text.endsWith('!')) reminder.text += '.';
      await discord.try_dms(reminder.to_id, `${reminder.from_username} wanted me to remind you ${reminder.text}`)
        .then(sent => sent ? Promise.resolve() : discord.try_dms(reminder.from_id, `Couldn't deliver reminder to ${reminder.to_username}.`));
      dirty = true;
    } else {
      futureReminders.push(reminder);
    }
  }
  
  if (dirty) await (futureReminders.length > 0 ? memory.set(`reminders:user:${user_id}`, futureReminders) : memory.unset(`reminders:user:${user_id}`));
  return Promise.resolve();
}

async function verifyMemory() {
  try {
    await memory_health.verify();
    await memory_health.testAPIs();
  } catch (ex) {
    await discord.dms(process.env.OWNER_DISCORD_USER_ID, '**Memory Verification FAILED**\n' + ex.stack);
  }
}

  module.exports = { handle }
