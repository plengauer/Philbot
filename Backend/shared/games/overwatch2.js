const memory = require('../memory.js');
const discord = require('../discord.js');
const troll = require('./troll.js');
const games_util = require('./games_util.js');

async function getInformation() {
  return troll.getInformation();
}

const ranked_system = {
  'Competitive': [
    { name:     'Top 500', color: 0x9355a7 },
    { name: 'Grandmaster', color: 0xffecff },
    { name:      'Master', color: 0xff8b00 },
    { name:     'Diamond', color: 0x70a1b1 },
    { name:    'Platinum', color: 0x94b464 },
    { name:        'Gold', color: 0xffae00 },
    { name:      'Silver', color: 0xa5a5a5 },
    { name:      'Bronze', color: 0x834a12 },
  ]
};

async function updateRankedRoles(guild_id, user_id) {
  return games_util.updateRankedRoles(guild_id, user_id, 'Fortnite', ranked_system, resolveAccount, getRanks);
}

async function resolveAccount(user_id) {
  return discord.user_retrieve(user_id)
    .then(result => result.username)
    .then(user_name => memory.get('activity_hint_config:activity:Overwatch 2:user:' + user_id, user_name));
}

async function getRanks(player) {
  return http_tracker(player)
    .then(response => response.data.stats.p2.currentRank)
    .then(rank => rank.split(' ').slice(-1).join(' '))
    .then(rank => { return [ { mode: 'Competitive', name: rank } ]; })
    .catch(() => null);
}

async function http_tracker(player) {
  throw new Error('Implement me!');
}

module.exports = { getInformation, updateRankedRoles }

















