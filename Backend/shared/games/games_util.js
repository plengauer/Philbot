const memory = require('../memory.js');
const synchronized = require('../synchronized.js');
const discord = require('../discord.js');

async function getUserAccount(user_id, activity, servers) {
  let accounts = await memory.get('activity_hint_config:activity:' + activity + ':user:' + user_id, null);
  if (accounts) return accounts;
  let user = await discord.user_retrieve(user_id);
  let name = discord.user2name(user);
  if (name.match(/#\d+$/)) {
    let tokens = name.split('#');
    name = tokens.slice(0, tokens.length - 1).join('#');
  }
  return servers.length > 0 ? servers.map(server => { return { server: server, name: name }; }) : [{ server: null, name: name }];
}

async function updateRankedRoles(guild_id, user_id, activity, config, getUserRanks) {
  let roles = await synchronized.locked('ranked_roles:setup:guild:' + guild_id, () => getRoles(guild_id, activity, config.ranked_system));
  let account = await getUserAccount(user_id, activity, config.servers ?? []);
  if (!account) return;
  let member = await discord.guild_member_retrieve(guild_id, user_id);
  let user_ranks = await getUserRanks(account);
  if (user_ranks == null || user_ranks == undefined) return promptConfiguration(user_id, activity, config.servers ?? []);
  for (let mode in config.ranked_system) {
    for (let rank of config.ranked_system[mode]) {
      let role_id = roles[mode][rank.name];
      let actual = member.roles.includes(role_id);
      let expected = user_ranks.some(user_rank => user_rank.mode == mode && user_rank.name == rank.name);
      if (!actual && expected) await discord.guild_member_role_assign(guild_id, user_id, role_id);
      if (actual && !expected) await discord.guild_member_role_unassign(guild_id, user_id, role_id);
    }
  }
}

async function promptConfiguration(user_id, activity, servers) {
  return synchronized.locked('activity:config:prompt:user:' + user_id, () => promptConfiguration0(user_id, activity, servers));
}

async function promptConfiguration0(user_id, activity, servers) {
  let muted = await memory.get('mute:auto:activity_hint_config:activity:' + activity + ':user:' + user_id, false);
  if (muted) return;
  await memory.set('mute:auto:activity_hint_config:activity:' + activity + ':user:' + user_id, true, 60 * 60 * 24 * 7 * 4);
  let instruction = 'Respond with \'configure ' + activity + (servers.length > 0 ? '<server>' : '') + ' <name>\', filling in your information.' + (servers.length > 0 ? ' Valid servers are ' + servers.join(', ') + '.' : '');
  await discord.try_dms(user_id, 'To give you real-time hints and assign roles based on your competitive rank, I need your in-game name. ' + instruction);
  return;
}

async function getRoles(guild_id, activity, system) {
  let roles_key = 'roles:activity:' + activity + ':guild:' + guild_id;
  let roles = await memory.get(roles_key, null);
  if (!roles) roles = {};
  let all_roles = await discord.guild_roles_list(guild_id).then(roles => roles.map(role => role.id));
  for(let mode in system) {
    if (!roles[mode]) roles[mode] = {};
    for (let rank of system[mode]) {
      if (!roles[mode][rank.name] || !all_roles.includes(roles[mode][rank.name])) {
      	roles[mode][rank.name] = await discord.guild_role_create(guild_id, activity + ' ' + mode + ' ' + rank.name, '0', true, true, rank.color).then(role => role.id);
      }
    }
  }
  await memory.set(roles_key, roles);
  return roles;
}

module.exports = { getUserAccount, promptConfiguration, updateRankedRoles }
