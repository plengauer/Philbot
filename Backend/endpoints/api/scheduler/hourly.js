const memory = require('../../../shared/memory.js');
const discord = require('../../../shared/discord.js');
const datefinder = require('../../../shared/datefinder.js');
const features = require('../../../shared/features.js');
const subscriptions = require('../../../shared/subscriptions.js');

const scheduling_distance = 1000 * 60 * 60 * 24 * 3;

async function handle() {
  return Promise.all([
    discord.guilds_list().then(guilds => Promise.all(guilds.map(guild => scheduleEvents(guild)))),
    sendReminders(),
    subscriptions.tick()
  ])
  .then(() => undefined)
}

async function scheduleEvents(guild) {
  return features.isActive(guild.id, 'repeating events').then(active => active ?
    memory.get(`repeating_events:config:guild:${guild.id}`, [])
      .then(event_configs => Promise.all(event_configs.map(event_config => tryScheduleEvent(guild, event_config)))) :
    Promise.resolve());
}

async function tryScheduleEvent(guild, event_config) {
  let now = new Date();
  if ((await memory.list([ `mute:event:guild:${guild.id}:name:${event_config.name}`, `mute:auto:event:guild:${guild.id}:name:${event_config.name}:schedule:${event_config.schedule.day}.${event_config.schedule.hour}.${event_config.schedule.minute}` ])).reduce((e1, e2) => e1.value || e2.value, false)) {
    return Promise.resolve();
  }
  
  let scheduled_start = await datefinder.findNext(now, event_config.schedule.day, event_config.schedule.hour, event_config.schedule.minute, event_config.schedule.timezone);
  let distance = scheduled_start.getTime() - now.getTime();
  if (distance > scheduling_distance) { 
    return Promise.resolve();
  }
  
  let found = false;
  for (let event of await discord.scheduledevents_list(guild.id)) {
    found = found || ((!event_config.name || event.name === event_config.name) && new Date(event.scheduled_start_time).getTime() == scheduled_start.getTime());
  }
  if (found) {
    return Promise.resolve();
  }
  
  await memory.set(`mute:auto:event:guild:${guild.id}:name:${event_config.name}:schedule:${event_config.schedule.day}.${event_config.schedule.hour}.${event_config.schedule.minute}`, true, scheduling_distance / 1000);
  
  if (Math.random() > event_config.probability) {
    return Promise.resolve();
  }
    
  if (!event_config.name) {
    let activities = await discord.guild_members_list(guild.id)
      .then(members => memory.list(members.map(member => `activities:all:user:${member.user.id}`)))
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
    for (let channel of await discord.guild_channels_list(guild.id)) {
      if (channel.name == event_config.name && (channel.type == 2 || channel.type == 13)) {
        event_config.channel_id = channel.id;
        break;
      }
    }
  } else if (!event_config.channel_id) {
    for (let channel of await discord.guild_channels_list(guild.id)) {
      if (channel.name == event_config.name && (channel.type == 2 || channel.type == 13)) {
        event_config.channel_id = channel.id;
        break;
      }
    }
  }
  
  if (!event_config.name || !event_config.channel_id) {
    return Promise.resolve();
  }
  
  return discord.scheduledevent_create(guild.id, event_config.channel_id, event_config.name, event_config.description, scheduled_start);
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

  module.exports = { handle }
