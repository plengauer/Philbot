const process = require('process');
const memory = require('../memory.js');
const discord = require('../discord.js');
const curl = require('../curl.js');
const troll = require('./troll.js');

async function getInformation() {
  return troll.getInformation();
}

function getConfigHint() {
  return {
    text: 'I cannot determine your EA Origin name. If you want me to give you hints about your current game, tell me your EA Origin name (even if you play on Steam, I need the Origin name that is linked to your steam account).'
      + ' Respond with \'configure Apex Legends NoobSlayerXXX\', filling in your EA Origin name.',
    ttl: 60 * 60 * 24 * 7
  };
}

const ranks = [ 'Rookie', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Apex Predator' ].reverse();
const rank_colors = [ 0x3a1a00, 0x834a12, 0xa5a5a5, 0xffae00, 0x64b2b4, 0x707fb1, 0x9d70b1, 0xc23435 ].reverse();
const modes  = [ 'Battle Royal', 'Arena' ];

async function updateRankedRoles(guild_id, user_id) {
  let roles_key = 'roles:activity:Apex Legends:guild:' + guild_id;
  let roles = await memory.get(roles_key, null);
  if (!roles) roles = {};
  let all_roles = await discord.guild_roles_list(guild_id).then(roles => roles.map(role => role.id));
  for(let mode of modes) {
    if (!roles[mode]) roles[mode] = {};
    for (let rank of ranks) {
      if (!roles[mode][rank] || !all_roles.includes(roles[mode][rank])) roles[mode][rank] = await createRole(guild_id, mode, rank);
    }
  }
  await memory.set(roles_key, roles);

  let name = await resolveAccount(user_id);
  let member = await discord.guild_member_retrieve(guild_id, user_id);
  let data = await http('/bridge', { player: name, platform: 'PC' });
  if (!data || data.Error || !data.global) return;
  for (let mode of modes) {
    for (let rank of ranks) {
      let role_id = roles[mode][rank];
      let actual = member.roles.includes(role_id);
      let expected = data.global[mode == 'Battle Royal' ? 'rank' : mode.toLowerCase()]?.rankName == rank;
      if (!actual && expected) await discord.guild_member_role_assign(guild_id, user_id, role_id);
      if (actual && !expected) await discord.guild_member_role_unassign(guild_id, user_id, role_id);
    }
  }
}

async function resolveAccount(user_id) {
  return discord.user_retrieve(user_id)
    .then(result => result.username)
    .then(user_name => memory.get('activity_hint_config:activity:Apex Legends:user:' + user_id, user_name))
}

async function createRole(guild_id, mode, rank) {
  return discord.guild_role_create(guild_id, createRoleName(mode, rank), '0', true, true, rank_colors[ranks.indexOf(rank)]).then(role => role.id);
}

function createRoleName(mode, rank) {
  return 'Apex Legends ' + mode + ' ' + rank;
}

async function http(endpoint, parameters = {}) {
  return curl.request({ hostname: 'api.mozambiquehe.re', path: endpoint + '?' + Object.keys(parameters).map(key => key + '=' + encodeURIComponent(parameters[key])).join('&'), headers: { 'authorization': process.env.APEX_LEGENDS_API_TOKEN, 'accept': '*/*' } })
    .then(result => JSON.parse(result))
    .catch(error => error.message.includes('HTTP error 404') ? null : Promise.reject(error));
}

module.exports = { getInformation, updateRankedRoles }

















