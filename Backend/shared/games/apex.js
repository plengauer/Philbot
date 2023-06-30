const process = require('process');
const curl = require('../curl.js');
const trackernetwork_gg = require('./trackernetwork_gg.js');
const troll = require('./troll.js');
const games_util = require('./games_util.js');

async function getInformation() {
  return troll.getInformation();
}

const ranks = [
  { name: 'Apex Predator', color: 0xc23435 },
  { name:        'Master', color: 0x9d70b1 },
  { name:       'Diamond', color: 0x707fb1 },
  { name:      'Platinum', color: 0x64b2b4 },
  { name:          'Gold', color: 0xffae00 },
  { name:        'Silver', color: 0xa5a5a5 },
  { name:        'Bronze', color: 0x834a12 },
  { name:        'Rookie', color: 0x3a1a00 },
];

const ranked_system = {
  'Battle Royale': ranks,
  'Arena': ranks,
};

async function updateRankedRoles(guild_id, user_id) {
  return games_util.updateRankedRoles(guild_id, user_id, 'Apex Legends', { ranked_system: ranked_system }, getRankss);
}

async function getRankss(accounts){
  return Promise.all(accounts.map(account => getRanks(account)))
    .then(rankss => rankss.reduce((r1, r2) => r1.concat(r2), []))
    .catch(error => undefined);
}

async function getRanks(account) {
  return http_algs_api(account.name)
    .then(result => {
      return [
        { mode: 'Battle Royale', name: result.global.rank.rankScore > 1 ? result.global.rank.rankName : 'Unranked' },
        { mode: 'Arena', name: result.global.arena.rankScore > 1 ? result.global.arena.rankName : 'Unranked' }
      ];
    })
    .catch(error => http_tracker(account.name)
      .then(result => {
        return [
          { mode: 'Battle Royale', name: result.data.metadata.rankName.split(' ')[0] },
        ];
      })
    )
    .then(ranks => ranks.filter(rank => rank.name != 'Unranked'));
}

async function http_algs_api(player) {
  return curl.request({ hostname: 'api.mozambiquehe.re', path: '/bridge?player=' + encodeURIComponent(player) + '&platform=PC', headers: { 'authorization': process.env.APEX_LEGENDS_API_TOKEN } });
}

async function http_tracker(player) {
  // API broken (returns 500 which should be 404, causing retries and therefore unhandled errors)
  throw new Error();
  return trackernetwork_gg.get('public-api.tracker.gg', '/apex/v1/standard/profile/5/' + encodeURIComponent(player));
}

module.exports = { getInformation, updateRankedRoles }

















