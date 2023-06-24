const process = require('process');
const memory = require('../memory.js');
const discord = require('../discord.js');
const curl = require('../curl.js');
const trackernetwork_gg = require('./trackernetwork_gg.js');
const troll = require('./troll.js');
const games_util = require('./games_util.js');

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
  return games_util.updateRankedRoles(guild_id, user_id, 'Apex Legends', ranked_system, resolveAccount, getRanks);
}

async function resolveAccount(user_id) {
  return discord.user_retrieve(user_id)
    .then(result => discord.user2name(result))
    .then(user_name => memory.get('activity_hint_config:activity:Apex Legends:user:' + user_id, user_name))
}

async function getRanks(player) {
  return http_algs_api(player)
    .then(result => {
      return [
        { mode: 'Battle Royale', name: result.global.rank.rankScore > 1 ? result.global.rank.rankName : 'Unranked' },
        { mode: 'Arena', name: result.global.arena.rankScore > 1 ? result.global.arena.rankName : 'Unranked' }
      ];
    })
    .catch(error => http_tracker(player)
      .then(result => {
        return [
          { mode: 'Battle Royale', name: result.data.metadata.rankName.split(' ')[0] },
        ];
      })
    )
    .catch(error => [])
    .then(ranks => ranks.filter(rank => rank.name != 'Unranked'));
}

async function http_algs_api(player) {
  return curl.request({ hostname: 'api.mozambiquehe.re', path: '/bridge?player=' + encodeURIComponent(player) + '&platform=PC', headers: { 'authorization': process.env.APEX_LEGENDS_API_TOKEN, 'accept': '*/*' } })
    .then(result => JSON.parse(result));
}

async function http_tracker(player) {
  return trackernetwork_gg.get('public-api.tracker.gg', '/apex/v1/standard/profile/5/' + encodeURIComponent(player));
}

module.exports = { getInformation, updateRankedRoles }

















