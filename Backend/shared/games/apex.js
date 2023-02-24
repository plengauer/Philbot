const troll = require('./troll.js');

async function getInformation() {
  return troll.getInformation();
}

function getConfigHint() {
  return {
    text: 'I cannot determine your in-game name. If you want me to give you hints about your current game, tell me your EA Origin name (even if you play on Steam, I need the Origin name that is linked to your steam account).'
      + ' Respond with \'configure Apex Legends NoobSlayerXXX\', filling in your EA Origin name.'
      + ' You can list more one name, separate the, with \';\'.',
    ttl: 60 * 60 * 24 * 7
  };
}

const ranks = [ 'Rookie', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Apex Predetor' ].reverse();
const rank_colors = [ 0x504c4c, 0x834a12, 0xa5a5a5, 0xffae00, 0x94b464, 0x70a1b1, 0x9d70b1, 0xa57365, 0x0c3c77 ].reverse();
const queues = 

async function updateRankedRoles(guild_id, user_id) {
  let roles_key = 'roles:activity:Apex Legends:guild:' + guild_id;
  let roles = await memory.get(roles_key, null);
  if (!roles) roles = {};
  let all_roles = await discord.guild_roles_list(guild_id).then(role => role.id);
  for(let queue of queues) {
    if (!roles[queue]) roles[queue] = {};
    for (let rank of ranks) {
      if (!roles[queue][rank] || !all_roles.includes(roles[queue][rank])) roles[queue][rank] = await createRole(guild_id, queue, rank);
    }
  }
  await memory.set(roles_key, roles);
}

module.exports = { getInformation, updateRankedRoles }

















