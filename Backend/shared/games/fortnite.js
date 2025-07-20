const memory = require('../memory.js');
const discord = require('../discord.js');
const trackernetwork_gg = require('./trackernetwork_gg.js');
const games_util = require('./games_util.js');

const ranks = [
  { name: 'Champion League', color: 0x00d8d8 },
  { name: 'Contender League', color: 0x00d8d8 },
  { name: 'Open League', color: 0x00d8d8 },
];

const ranked_system = {
  'Battle Royale': ranks,
};

async function updateRankedRoles(guild_id, user_id) {
  return games_util.updateRankedRoles(guild_id, user_id, 'Fortnite', { ranked_system: ranked_system }, getRankss);
}

async function getRankss(accounts) {
  return Promise.all(accounts.map(account => getRanks(account))).catch(() => undefined);
}

async function getRanks(account) {
  return http_tracker(account.name)
    .then(response => response.data.stats.p2.currentRank)
    .then(rank => rank.split(' ').slice(-1).join(' '))
    .then(rank => { return [ { mode: 'Battle Royale', name: rank } ]; });
}

async function http_tracker(player) {
  return trackernetwork_gg.get('api.fortnitetracker.com', '/v1/profile/pc/' + encodeURIComponent(player));
}

module.exports = { updateRankedRoles }

















