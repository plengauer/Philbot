const sdk = require('../../shared/opentelemetry.js').create(context.service.version);
await sdk.start();
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode');
const discord = require('../../shared/discord.js');
const timeout = require('../../shared/timeout.js');
const memory = require('../../shared/memory.js');
const statistics = require('../../shared/statistics.js');
const delayed_memory = require('../../shared/delayed_memory.js');
const games = require('../../shared/games/games.js');

const mute_ttl = 60 * 60 * 24 * 7 * 4;
const mute_auto_ttl = 60 * 60 * 2;
const all_activities_ttl = 60 * 60 * 24 * 7 * 13;
const current_activities_ttl = 60 * 60 * 24;
// const starting_activities_ttl = 60 * 3;

async function getActivityEmergencyNotification(name, details, state, user_name) {
  return games.getActivityEmergencyNotification(name, details, state, user_name);
}

async function sendHint(guild_id, user_id, activity) {
  let role = await memory.get(`notification:role:guild:${guild_id}`, null);
  if (role) {
    let member = await discord.guild_member_retrieve(guild_id, user_id);
    if (member && !member.roles.some(role_id => role_id === role)) return Promise.resolve();
  }

  let hint = await games.getActivityHint(activity.name, activity.details, activity.state, user_id);
  if (!hint) {
    return Promise.resolve();
  }

  // when a user is in two guilds, they race to send hints, hints are sent twice
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  await delay(Math.floor(Math.random() * 20 * 1000));
  
  let custom_auto_mute_appendix = hint.ttl_key ? `:key:${hint.ttl_key}` : '';
  
  let muted = await memory.list([`mute:auto:hint:user:${user_id}:activity:${activity.name}${custom_auto_mute_appendix}`, `mute:activity:${activity.name}`, `mute:user:${user_id}`, `mute:user:${user_id}:activity:${activity.name}`])
    .then(entries => entries.map(entry => entry.value).reduce((b1, b2) => b1 || b2, false));
  if (muted) {
    return Promise.resolve();
  }
  await memory.set(`mute:auto:hint:user:${user_id}:activity:${activity.name}${custom_auto_mute_appendix}`, true, hint.ttl ?? mute_auto_ttl);
  
  let span = tracer.startSpan('functions.events.discord.presence.update.activity.hint');
  span.setAttribute("discord.user.id", user_id);
  span.setAttribute("discord.activity.name", activity.name);
  span.setAttribute("discord.activity.details", activity.details);
  span.setAttribute("discord.activity.state", activity.state);
  span.setAttribute("discord.activity.hint", hint.text);
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => 
    discord.try_dms(user_id,
        `You are playing ${activity.name}: ${hint.text}`
         + (Math.random() < 0.25 ? ` Respond with "mute for me" or "mute for ${activity.name}" if you want me to stop providing hints to you for a while.` : '')
      ).then(sent => Promise.all([
        sent ? statistics.record(`notifications:activity:hint:activity:${activity.name}:user:${user_id}`) : Promise.resolve(),
        delayed_memory.set(`response:` + memory.mask('mute for me') + `:user:${user_id}`, `mute:user:${user_id}`, true, mute_ttl),
        delayed_memory.set(`response:` + memory.mask(`mute for ${activity.name}`) + `:user:${user_id}`, `mute:user:${user_id}:activity:${activity.name}`, true, mute_ttl)
      ])).catch(ex => {
        span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR });
        span.recordException(ex);
        throw ex;
      })
    ).finally(() => span.end());
}

async function sendHints(guild_id, user_id, activities) {
  let span = tracer.startSpan('functions.events.discord.presence.update.activity.hints');
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
    span.setAttribute("discord.activities", activities.map(a => `${a.name}, ${a.details}, ${a.state}`));
    return Promise.all(activities.map(activity => sendHint(guild_id, user_id, activity)))
      .catch(ex => {
        span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR });
        span.recordException(ex);
        throw ex;
      });
  }).finally(() => span.end());
}

async function sendManualNotification(guild_id, user_id, user_name, activity, member) {
  let id = member.user.id;
  if (id == user_id) return Promise.resolve();
  
  let do_notify = await memory.list([ `notify:user:${id}`, `notify:user:${id}:activity:${activity}` ])
   .then(entries => entries.map(entry => entry.value).reduce((b1, b2) => b1 || b2, false));
  if (!do_notify) return Promise.resolve();
  
  let mute = await memory.list([ `mute:auto:manual:guild:${guild_id}:user:${id}:other:${user_id}:activity:${activity}`, `mute:activity:${activity}`, `mute:user:${id}`, `mute:user:${id}:activity:${activity}`, `mute:user:${id}:other:${user_id}` ])
    .then(entries => entries.map(entry => entry.value).reduce((b1, b2) => b1 || b2, false));
  await memory.set(`mute:auto:manual:guild:${guild_id}:user:${id}:other:${user_id}:activity:${activity}`, true, mute_auto_ttl);
  if (mute) return Promise.resolve();
  
  let span = tracer.startSpan('functions.events.discord.presence.update.notification.manual');
  span.setAttribute("discord.user_from.id", user_id);
  span.setAttribute("discord.user_to.id", id);
  span.setAttribute("discord.activity.name", activity);
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => 
    discord.try_dms(id, '**' + user_name + '** is playing **' + activity + '**.'
        + (Math.random() < 0.25 ? ` Respond with "mute for me", "mute for ${activity}", or "mute for ${user_name}" if you want me to stop notifying you for a while.` : '')
      ).then(sent => Promise.all([
        sent ? statistics.record(`notifications:activity:manual:activity:${activity}:guild:${guild_id}:user:${user_id}`) : Promise.resolve(),
        delayed_memory.set(`response:` + memory.mask(`mute for me`) + `:user:${id}`, `mute:user:${id}`, true, mute_ttl),
        delayed_memory.set(`response:` + memory.mask(`mute for ${activity}`) + `:user:${id}`, `mute:user:${id}:activity:${activity}`, true, mute_ttl),
        delayed_memory.set(`response:` + memory.mask(`mute for ${user_name}`) + `:user:${id}`, `mute:user:${id}:other:${user_id}`, true, mute_ttl)
      ])).catch(ex => {
        span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR });
        span.recordException(ex);
        throw ex;
      })
    ).finally(() => span.end());
}

async function sendManualNotifications(guild_id, user_id, user_name, activities, members) {
  let span = tracer.startSpan('functions.events.discord.presence.update.activity.notifications.manual');
  span.setAttribute("discord.user.id", user_id);
  span.setAttribute("discord.activities", activities);
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
    return Promise.all(activities.map(activity => Promise.all(members.map(member => sendManualNotification(guild_id, user_id, user_name, activity, member)))))
      .catch(ex => {
        span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR });
        span.recordException(ex);
        throw ex;
      });
  }).finally(() => span.end());
}

async function sendAutomaticNotification(guild_id, guild_name, member, activities, members_with_same_activity) {
  let voice_channel_promise = memory.get(`voice_channel:user:${member}`, null);
  let muted_members_promise = Promise.all(
      members_with_same_activity.map(other => memory.get(`mute:user:${member}:other:${other}`, false)
        .then(muted => muted ? other : null)
      )
    ).then(muted_members => muted_members.filter(other => other != null));
  let mute_promise = memory.list([ `mute:auto:automatic:guild:${guild_id}:user:${member}`, `mute:user:${member}` ]
      .concat(
        activities.map(activity => [ `mute:auto:automatic:guild:${guild_id}:user:${member}:activity:${activity}`, `mute:activity:${activity}`, `mute:user:${member}:activity:${activity}` ])
          .flatMap(keys => keys)
      )
    ).then(entries => entries.map(entry => entry.value).reduce((b1, b2) => b1 || b2, false));
  
  if (await voice_channel_promise) {
    return Promise.resolve();
  }
  
  let muted_members = await muted_members_promise;
  members_with_same_activity = members_with_same_activity.filter(member => !muted_members.includes(member));
  if (members_with_same_activity.length <= 1) {
    return Promise.resolve();
  }
  
  let mute = await mute_promise;
  if (activities.length == 1) {
    await memory.set(`mute:auto:automatic:guild:${guild_id}:user:${member}:activity:${activities[0]}`, true, mute_auto_ttl);
  } else {
    await memory.set(`mute:auto:automatic:guild:${guild_id}:user:${member}`, true, mute_auto_ttl);
  }
  if (mute) {
    return Promise.resolve();
  }
  
  /*
  let starting = false;
  for (let starting_activity of await memory.get(`activities:starting:user:${member}`, [])) {
    starting = starting || activities.includes(starting_activity);
  }
  if (starting) {
    let values = await Promise.all(members_with_same_activity.filter(other_member => other_member !== member).map(other_member =>
        memory.get(`activities:starting:user:${other_member}`, []).then(other_starting_activities => { 
          for (let activity of activities) {
            if(other_starting_activities.includes(activity)) return true;
          }
          return false;
        })
      ));
    for (let value of values) {
      if (value) return Promise.resolve();
    }
  }
  */
  
  let others = await Promise.all(members_with_same_activity.filter(other_member => other_member !== member).map(other_member =>
      discord.guild_member_retrieve(guild_id, other_member)
        .then(data => data.nick ?? data.user.username)
        .then(name => delayed_memory.set(`response:` + memory.mask(`mute for ${name}`) + `:user:${member}`, `mute:user:${member}:other:${other_member}`, true, mute_ttl).then(() => name))
        .then(name => '**' + name + '**')
    )).then(names => names.join(' and '));
  await delayed_memory.set(`response:` + memory.mask(`mute for me`) + `:user:${member}`, `mute:user:${member}`, true, mute_ttl);
  if (activities.length == 1) {
    await delayed_memory.set(`response:` + memory.mask(`mute for ${activities[0]}`) + `:user:${member}`, `mute:user:${member}:activity:${activities[0]}`, true, mute_ttl);
  }
  
  let span = tracer.startSpan('functions.events.discord.presence.update.activity.notification.automatic');
  span.setAttribute("discord.guild.id", guild_id);
  span.setAttribute("discord.user.id", member);
  span.setAttribute("discord.activities", activities);
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => 
      discord.try_dms(member,
        '' + others + ' ' + (members_with_same_activity.length == 2 ? 'is' : 'are') + ' ' + (activities.length == 1 ? `also playing ${activities[0]}` : 'playing the same as you') + '.'
        + ` Why don\'t you meet up in ${guild_name}?`
        + (Math.random() < 0.25 ? ' Respond with "mute for me"' + (activities.length == 1 ? `, "mute for ${activities[0]}"` : '') + ', or "mute for <name>" if you want me to stop notifying you for a while.' : '')
      ).then(sent => sent ?
        Promise.all(activities.map(activity => statistics.record(`notifications:activity:automatic:activity:${activity}:guild:${guild_id}:user:${member}`))) :
        Promise.resolve()
      ).catch(ex => {
        span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR });
        span.recordException(ex);
        throw ex;
      })
    ).finally(() => span.end());
}

async function sendAutomaticNotifications0(guild_id, guild_name, activities, members) {
  let role = await memory.get(`notification:role:guild:${guild_id}`, null);
  // search members that have the same current activity
  let members_with_same_activity_promises = members
    .filter(member => !role || member.roles.some(role_id => role_id === role))
    .map(member => memory.get(`activities:current:user:${member.user.id}`, []).then(other_activities => {
      for (let other_activity of other_activities) {
        for (let activity of activities) {
          if (activity === other_activity) {
            return member.user.id;
          }
        }
      }
      return null;
    }));
    
  let members_with_same_activity = [];
  for (let member_with_same_activity_promise of members_with_same_activity_promises) {
    let member_with_same_activity = await member_with_same_activity_promise;
    if (!member_with_same_activity) continue;
    members_with_same_activity.push(member_with_same_activity);
  }

  if (members_with_same_activity.length > 10) {
    return Promise.resolve();
  }
  // abort if there is only 1 (i.e., self) member with the same current activity
  if (members_with_same_activity.length <= 1) {
    return Promise.resolve();
  }
  return Promise.all(members_with_same_activity.map(member => sendAutomaticNotification(guild_id, guild_name, member, activities, members_with_same_activity)));
}

async function sendAutomaticNotifications(guild_id, guild_name, activities, members) {
  let span = tracer.startSpan('functions.events.discord.presence.update.activity.notifications.automatic');
  span.setAttribute("discord.guild.id", guild_id);
  span.setAttribute("discord.activities", activities);
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
    return sendAutomaticNotifications0(guild_id, guild_name, activities, members)
      .catch(ex => {
        span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR });
        span.recordException(ex);
        throw ex;
      });
  }).finally(() => span.end());
}

async function sendEmergencyNotification(guild_id, user_id, activity, notification, sender_user_id, sender_user_name, sender_voice_channel) {
  if (sender_voice_channel) {
    let user_voice_channel = await memory.get(`voice_channel:user:${user_id}`, null);
    if (user_voice_channel && user_voice_channel.guild_id === sender_voice_channel.guild_id && user_voice_channel.channel_id === sender_voice_channel.channel_id) {
      return Promise.resolve();
    }
  }
  
  let mute = await memory.list([`mute:auto:emergency:guild:${guild_id}:user:${user_id}`, `mute:auto:emergency:guild:${guild_id}:user:${user_id}:activity:${activity}`, `mute:activity:${activity}`, `mute:user:${user_id}`, `mute:user:${user_id}:activity:${activity}`, `mute:user:${user_id}:other${sender_user_id}`])
    .then(entries => entries.map(entry => entry.value).reduce((b1, b2) => b1 || b2, false));
  await memory.set(`mute:auto:emergency:guild:${guild_id}:user:${user_id}:activity:${activity}`, true, mute_auto_ttl);
  if (mute) {
    return Promise.resolve();
  }

  let span = tracer.startSpan('functions.events.discord.presence.update.activity.notification.emergency');
  span.setAttribute("discord.user.id", user_id);
  span.setAttribute("discord.activity.name", activity);
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => 
      discord.try_dms(user_id, notification
          + ' Come and help if you can.'
          + (Math.random() < 0.25 ? ` Respond with "mute for me", "mute for ${activity}", or "mute for ${sender_user_name}" if you want me to stop notifying you for a while.` : '')
        ).then(sent => Promise.all([
          sent ? statistics.record(`notifications:activity:emergency:activity:${activity}:guild:${guild_id}:user:${user_id}`) : Promise.resolve(),
          delayed_memory.set(`response:` + memory.mask(`mute for me`) + `:user:${user_id}`, `mute:user:${user_id}`, true, mute_ttl),
          delayed_memory.set(`response:` + memory.mask(`mute for ${activity}`) + `:user:${user_id}`, `mute:user:${user_id}:activity:${activity}`, true, mute_ttl),
          delayed_memory.set(`response:` + memory.mask(`mute for ${sender_user_name}`) + `:user:${user_id}`, `mute:user:${user_id}:other${sender_user_id}`, true, mute_ttl)
        ])).catch(ex => {
          span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR });
          span.recordException(ex);
          throw ex;
        })
    ).finally(() => span.end());
}

async function sendEmergencyNotifications0(guild_id, user_id, user_name, activity, notification, members) {
  if (!notification) return Promise.resolve();
  
  let voice_channel_promise = memory.get(`voice_channel:user:${user_id}`, null);
  let members_with_same_activity_promises = members
    .filter(member => member.user.id != user_id)
    .map(member => member.user.id)
    .map(member => memory.get(`activities:all:user:${member}`, []).then(other_activities => {
      for (let other_activity of other_activities) {
        if (activity === other_activity) {
          return member;
        }
      }
      return null;
    }));
  
  let voice_channel = await voice_channel_promise;
  let members_with_same_activity = [];
  for (let member_with_same_activity_promise of members_with_same_activity_promises) {
    let member_with_same_activity = await member_with_same_activity_promise;
    if (!member_with_same_activity) continue;
    members_with_same_activity.push(member_with_same_activity);
  }
  
  return Promise.all(members_with_same_activity.map(member => sendEmergencyNotification(guild_id, member, activity, notification, user_id, user_name, voice_channel)));
}

async function sendEmergencyNotifications(guild_id, user_id, user_name, activities, members) {
  let span = tracer.startSpan('functions.events.discord.presence.update.activity.notifications.emergency');
  span.setAttribute("discord.guild.id", guild_id);
  span.setAttribute("discord.user.id", user_id);
  span.setAttribute("discord.activities", activities);
  return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
    return Promise.all(activities
        .map(activity => getActivityEmergencyNotification(activity.name, activity.details, activity.state, user_name)
          .then(notification => sendEmergencyNotifications0(guild_id, user_id, user_name, activity.name, notification, members))
        )
      ).catch(ex => {
        span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR });
        span.recordException(ex);
        throw ex;
      });
  }).finally(() => span.end());
}

async function handle(guild_id, user_id, activities) {
  for (let activity of activities) {
    console.log(`Activity: ${activity.name}, ${activity.details}, ${activity.state}`);
  }
  
  // sanitize
  for (let activity of activities) {
    if (activity.name.startsWith('SnowRunner ::  KSIVA:')) {
      activity.name = 'SnowRunner';
    }
  }
  
  // filter muted to abort early
  // this muted check is a pure optimization, it trades off less storage costs vs more read accesses
  activities = await Promise.all(activities.filter(activity => activity.type == 0).map(activity => memory.get(`mute:activity:${activity.name}`, false).then(muted => muted ? null : activity)))
    .then(activities => activities.filter(activity => !!activity));
  
  // abort if there is no current activity
  if (activities.length == 0) {
    return memory.unset(`activities:current:user:${user_id}`);
  }

  let guild = await discord.guild_retrieve(guild_id);
  let members = await discord.guild_members_list(guild_id);
  let user_name = '';
  for (let member of members) {
    if (member.user.id !== user_id) {
      continue;
    }
    user_name = (member.nick && member.nick.length > 0) ? member.nick : member.user.username;
    break;
  }
  
  return Promise.all([
      memory.set(`activities:current:user:${user_id}`, activities.map(a => a.name), current_activities_ttl),
      // memory.set(`activities:starting:user:${user_id}`, activities, starting_activities_ttl),
      memory.get(`activities:all:user:${user_id}`, []).then(global_activities => 
        activities.some(activity => !global_activities.includes(activity.name)) ?
          memory.set(`activities:all:user:${user_id}`, global_activities.concat(activities.map(a => a.name).filter(activity => !global_activities.includes(activity))), all_activities_ttl) :
          Promise.resolve()
      ),
      memory.get(`activities:recent:user:${user_id}`, []).then(global_activities => 
        activities.some(activity => !global_activities.includes(activity.name)) ?
          memory.set(`activities:recent:user:${user_id}`, global_activities.concat(activities.map(a => a.name).filter(activity => !global_activities.includes(activity))), all_activities_ttl) :
          Promise.resolve()
      ),
      memory.get(`activities:global:user:${user_id}`, []).then(global_activities => 
        activities.some(activity => !global_activities.includes(activity.name)) ?
          memory.set(`activities:global:user:${user_id}`, global_activities.concat(activities.map(a => a.name).filter(activity => !global_activities.includes(activity))), all_activities_ttl) :
          Promise.resolve()
      ),
      sendHints(guild_id, user_id, activities),
      sendManualNotifications(guild_id, user_id, user_name, activities.map(a => a.name), members),
      sendAutomaticNotifications(guild_id, guild.name, activities.map(a => a.name), members),
      sendEmergencyNotifications(guild_id, user_id, user_name, activities, members)
    ]);
}

function getParentContext(activities) {
  for (let activity of activities) {
    if (!activity.party || !activity.party.id || !activity.party.id.startsWith("OT;")) {
      continue;
    }
    let tokens = activity.party.id.split(';');
    if (tokens.length != 4 || tokens[0] !== 'OT') continue;
    let trace_id = tokens[1];
    let span_id = tokens[2];
    let trace_state = tokens[3];
    return opentelemetry.trace.setSpanContext(opentelemetry.context.active(), { traceId: trace_id, spanId: span_id });
  }
  return opentelemetry.context.active();
}

let span = tracer.startSpan('functions.events.discord.presence.update.activity', { kind: opentelemetry.SpanKind.CONSUMER }, getParentContext(context.params.event.activities));
return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
    let guild_id = context.params.event.guild_id;
    let user_id = context.params.event.user.id;
    let activities = context.params.event.activities.filter(activity => activity.type != 4);
    span.setAttribute("discord.guild.id", guild_id);
    span.setAttribute("discord.user.id", user_id);
    span.setAttribute("discord.activities", activities.map(activity => activity.name + ', ' + activity.details + ', ' + activity.state).join(';'));
    return Promise.all([
      statistics.record(`trigger:discord.presence.update.activity:guild:${guild_id}:user:${user_id}`
        + (activities.length == 0 ? '' : (':activity:' + (activities.length == 1 ? activities[0].name : '<multiple>')))
      ),
      handle(guild_id, user_id, activities)
    ]).catch(ex => {
      span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR });
      span.recordException(ex);
      throw ex;
    });
  })
  .finally(() => span.end())
  .finally(() => sdk.shutdown());
