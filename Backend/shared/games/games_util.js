const memory = require('../memory.js');
const synchronized = require('../synchronized.js');

async function updateRankedRoles(guild_id, user_id, activity, system, getUserAccount, getUserRanks) {
  let roles = await synchronized.locked('ranked_roles:setup:guild:' + guild_id, () => getRoles(guild_id, activity, system));
  let account = await getUserAccount(user_id);
  if (!account) return;
  let member = await discord.guild_member_retrieve(guild_id, user_id);
  let user_ranks = await getUserRanks(account);
  if (!user_ranks) return;
  for (let mode in system) {
    for (let rank of system[mode]) {
      let role_id = roles[mode][rank.name];
      let actual = member.roles.includes(role_id);
      let expected = user_ranks.some(user_rank => user_rank.mode == mode && user_rank.name == rank.name);
      if (!actual && expected) await discord.guild_member_role_assign(guild_id, user_id, role_id);
      if (actual && !expected) await discord.guild_member_role_unassign(guild_id, user_id, role_id);
    }
  }
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

module.exports = { updateRankedRoles }
