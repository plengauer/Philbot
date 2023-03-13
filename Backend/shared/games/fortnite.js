const memory = require('../memory.js');
const discord = require('../discord.js');
const trackernetwork_gg = require('./trackernetwork_gg.js');
const troll = require('./troll.js');
const games_util = require('./games_util.js');

async function getInformation() {
  return troll.getInformation();
}

const ranks = [
  { name: 'Champion League', color: 0x00d8d8 },
  { name: 'Contender League', color: 0x00d8d8 },
  { name: 'Open League', color: 0x00d8d8 },
];

const ranked_system = {
  'Battle Royal': ranks,
};

async function updateRankedRoles(guild_id, user_id) {
  return games_util.updateRankedRoles(guild_id, user_id, 'Fortnite', ranked_system, resolveAccount, getRanks);
}

async function resolveAccount(user_id) {
  return discord.user_retrieve(user_id)
    .then(result => result.username)
    .then(user_name => memory.get('activity_hint_config:activity:Fortnite:user:' + user_id, user_name));
}

async function getRanks(player) {
  return http_tracker(player)
    .then(response => response.data.stats.p2.currentRank)
    .then(rank => rank.split(' ').slice(-1).join(' '))
    .then(rank => { return [ { mode: 'Battle Royal', name: rank } ]; });
}

async function http_tracker(player) {
  return trackernetwork_gg.get('api.fortnitetracker.com', '/v1/profile/pc/' + encodeURIComponent(player));
}

module.exports = { getInformation, updateRankedRoles }

















