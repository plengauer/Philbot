const memory = require('../../../shared/memory.js');
const discord = require('../../../shared/discord.js');
const permissions = require('../../../shared/permissions.js');
const features = require('../../../shared/features.js');
const games = require('../../../shared/games/games.js');

async function handle() {
  return Promise.all([
    memory.clean(),
    discord.guilds_list().then(guilds => Promise.all(guilds.map(guild => verifyPermissions(guild.id)))),
    sendBirthdayGreetings(),
    discord.guilds_list().then(guilds => Promise.all(guilds.map(guild => features.isActive(guild.id, "ranked game roles").then(active => active ? updateRankedRoles(guild.id) : Promise.resolve()))))
  ])
  .then(() => undefined)
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

async function updateRankedRoles(guild_id) {
  let user_ids = await discord.guild_members_list(guild_id).then(members => members.map(member => member.user.id));
  let activities = await Promise.all(user_ids.map(user_id => memory.get(`activities:all:user:${user_id}`, [])))
    .then(activities => Array.from(new Set(activities.reduce((a1, a2) => a1.concat(a2), []))));
  for (let user_id of user_ids) {
    for (activity of activities) {
      await games.updateRankedRoles(activity, guild_id, user_id);
    }
  }
}

module.exports = { handle }
