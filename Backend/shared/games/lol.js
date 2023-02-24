const process = require('process');
const curl = require('../curl.js');
const discord = require('../discord.js');
const memory = require('../memory.js');

const SERVERS = [ 'br1', 'eun1', 'euw1', 'jp1', 'kr', 'la1', 'la2', 'na1', 'oc1', 'ru', 'tr1' ];

async function http_get(server, endpoint, ttc = undefined) {
  return curl.request({ secure: true, method: 'GET', hostname: '' + server + '.api.riotgames.com', path: endpoint, headers: { 'X-Riot-Token': process.env.RIOT_API_TOKEN }, rate_limit_hint: { strip_digits : true }, cache: ttc });
}

function getConfigHint() {
  return {
    text: 'I cannot determine your summoner name. If you want me to give you hints about your current game, tell me your summoner name and the server you are on.'
      + ' Respond with \'configure League of Legends euw1 NoobSlayerXXX\', filling in your server and your summoner name.'
      + ' You can list more than one server + summoner name pairs, separate the pairs with \';\'.'
      + ' Valid servers are ' + SERVERS.join(', ') + '.',
    ttl: 60 * 60 * 24 * 7
  };
}

async function getInformation(details, state, user_id) {
  // estimation about calls 1+1+5+5*(1+1+100) = 517
  if (!process.env.RIOT_API_TOKEN) return null;

  let summoners = await resolveAccount(user_id);
  if (summoners.length == 0) return getConfigHint();
  
  let games = await Promise.all(summoners.map(summoner => getActiveGame(summoner.server, summoner.id))).then(games => games.filter(game => !!game));
  if (games.length > 1) return getConfigHint();
  if (games.length == 0 && details && state && (details.includes('Summoner\'s Rift') || details.includes('ARAM')) && !(details.includes('AI') || details.includes('Custom')) && (state == 'In Game' || state == 'Im Spiel' || state == 'En Jeu')) return getConfigHint(); // be careful to not catch TFT by accident
  if (games.length == 0) return null;
  
  let game = games[0];
  let summoner = summoners.filter(summoner => game.participants.some(participant => participant.summonerId == summoner.id))[0];
  
  let team_id = game.participants.filter(participant => participant.summonerId == summoner.id)[0].teamId;
  let enemies = game.participants.filter(participant => participant.teamId != team_id);
  
  let players = await Promise.all(enemies.map(enemy => getPlayerInfo(summoner.server, enemy.summonerId, enemy.summonerName, enemy.championId)));
  players = players.filter(player => !!player);
  
  let mdp = -1;
  let maxDangerCoefficient = 0;
  for (let i = 0; i < players.length; i++) {
    let dangerCoefficient = calculateCoefficient(players[i], players, game.gameMode, game.gameType);
    if (isNaN(dangerCoefficient)) throw new Error('Coefficient calculation is broken!');
    if (mdp < 0 || dangerCoefficient > maxDangerCoefficient) {
      mdp = i;
      maxDangerCoefficient = dangerCoefficient;
    }
  }
  
  /*
  //THIS IS CODE TO GUARD NEW FUNCTIONALITY
  let preview_users = [ process.env.OWNER_DISCORD_USER_ID, '257126105595641856', '288800273873502208', '213359140033134592' ];
  if (preview_users.includes(user_id)) {
    //TODO
  }
  */
  
  // individualPosition (TOP)
  // lane (TOP)
  //TODO show other highlights. who is gankable if you are a jungler
  // wardsPlaced
  // firstBloodAssist, firstBloodKill
  // dragonKills, baronKills
  
  /*
  if (myposition = JUNGLE) {
    badWarders = enemies.filter(lowWardsPlaced)
    addhint(badWarders)
  }
  */
  
  let history = await memory.get('activity_hint_history:activity:League of Legends', []);
  let accuracy = await memory.get('activity_hint_accuracy:activity:League of Legends', undefined);
  if (!accuracy && history.length > 0) {
    let matches = await Promise.all(history.map(entry => getMatch(entry.server.toUpperCase() + '_' + entry.match).catch(e => null)));
    let accuracies = [];
    for (let i = 0; i < history.length; i++) {
      if (!matches[i]) continue;
      let player = matches[i].participants.filter(participant => participant.summonerId == history[i].player)[0];
      let players = matches[i].participants.filter(participant => participant.teamId == player.teamId);
      let values = [
        1.0 * player.kills / players.map(p => p.kills).reduce((v1, v2) => Math.max(v1, v2), 0),
        1.0 * player.totalDamageDealtToChampions / players.map(p => p.totalDamageDealtToChampions).reduce((v1, v2) => Math.max(v1, v2), 0),
        1.0 * player.timeCCingOthers / players.map(p => p.timeCCingOthers).reduce((v1, v2) => Math.max(v1, v2), 0)
      ].map(v => isNaN(v) ? 1 : v); // to handle division by zero if for example where were no kills at all by the entire team
      accuracies.push(values.reduce((v1, v2) => v1 + v2, 0) / values.length);
    }
    accuracy = accuracies.reduce((a1, a2) => a1 + a2, 0) / accuracies.length;
    await memory.set('activity_hint_accuracy:activity:League of Legends', accuracy, 60 * 60 * 24);
  }
  await memory.set('activity_hint_history:activity:League of Legends', [{ server: summoner.server, match: game.gameId, player: players[mdp].id }].concat(history.filter(match => match.server != summoner.server || match.match != game.gameId || match.player != players[mdp].id)).slice(0, 100), 60 * 60 * 24 * 31);
  
  let premades = [];
  for (let player of players) {
    for (let other of players.filter(other => other.id != player.id)) {
      if (player.matches.filter(match => match.participants.some(participant => participant.summonerId == other.id)).length > 1) {
        if (!premades.some(premade => premade.id == player.id)) premades.push(player);
        if (!premades.some(premade => premade.id == other.id)) premades.push(other);
      }
    }
  }
  
  let wrongSpell = null;
  {
    let participant = game.participants.filter(participant => participant.summonerId == summoner.id)[0];
    if (getSummonerSpellName(participant.spell2Id) == 'Flash') {
      wrongSpell = getSummonerSpellName(participant.spell1Id);
    }
  }
  
  let text = '**' + (players[mdp].champion ?? players[mdp].summoner) + '** is your most dangerous enemy' + (accuracy && accuracy > 0.6 ? ' (accuracy ' + Math.floor(accuracy * 100) + '%)' : '') + '.'
    + (premades.length > 0 ? ' Be aware that ' + premades.map(player => player.champion ?? player.summoner).join(' and ') + ' are most likely premade and coordinating.' : '')
    + (wrongSpell && Math.random() > 0.9 ? ' Also, its **D** for **D**ash and **F** for **F**ucking ' + wrongSpell + '!' : '');
  return {
    text: text,
    ttl: 60 * 60 * 3,
    ttl_key: summoner.server.toUpperCase() + '_' + game.gameId
  };
}

function calculateCoefficient(player, team, mode, type) {
  let coefficients = [
      calculateMasteryLevelCoefficient(player.mastery, team.map(i => i.mastery)),
      calculateMasteryPointsCoefficient(player.mastery, team.map(i => i.mastery)),
      calculateMatchMetricCoefficient(player, team, mode, type, (match, statistics) => statistics.kills / match.gameDuration),
      calculateMatchMetricCoefficient(player, team, mode, type, (match, statistics) => statistics.totalDamageDealtToChampions / match.gameDuration),
      calculateMatchMetricCoefficient(player, team, mode, type, (match, statistics) => statistics.timeCCingOthers / match.gameDuration)
    ];
  return coefficients.map(c => isNaN(c) ? 0 : c).reduce((c1, c2) => c1 + c2, 0) / coefficients.length * team.length;
}

function calculateMasteryLevelCoefficient(mastery, masteries) {
  return mastery.level / masteries.map(otherMastery => otherMastery.level).reduce((a1, a2) => a1 + a2, 0);
}

function calculateMasteryPointsCoefficient(mastery, masteries) {
  return mastery.points / masteries.map(otherMastery => otherMastery.points).reduce((a1, a2) => a1 + a2, 0);
}

function calculateWinRatioCoefficient(player, team, mode, type) {
  return calculateWinRatio(player, mode, type) / team.map(other => calculateWinRatio(other, mode, type)).reduce((a1, a2) => a1 + a2, 0);
}

function calculateWinRatio(player, mode, type) {
  let matches = player.matches.filter(match => match.gameMode == mode && match.gameType == type);
  return matches.filter(match => match.participants.filter(participant => participant.summonerId == player.id)[0].win).length / matches.length;
}

function calculateMatchMetricCoefficient(player, team, mode, type, getMetric) {
  return calculateMatchMetricMedian(player, mode, type, getMetric) / team.map(other => calculateMatchMetricMedian(other, mode, type, getMetric)).reduce((a1, a2) => a1 + a2, 0);
}

function calculateMatchMetricMedian(player, mode, type, getMetric) {
  return median(player.matches.filter(match => match.gameMode == mode && match.gameType == type).map(match => getMetric(match, match.participants.filter(participant => participant.summonerId == player.id)[0])));
}

async function resolveAccount(user_id) {
  let servers = await Promise.all(SERVERS.map(server => memory.get('mute:activity:League of Legends:server:' + server, false).then(muted => muted ? null : server)))
    .then(servers => servers.filter(server => server));
  
  return discord.user_retrieve(user_id)
    .then(result => result.username)
    .then(user_name => memory.get('activity_hint_config:activity:League of Legends:user:' + user_id, servers.map(server => { return { summoner: user_name, server: server }; })))
    .then(configs => Promise.all(configs.map(config => getSummoner(config.server, config.summoner))).then(summoners => summoners.filter(summoner => !!summoner)));
}

async function getSummoner(server, summonerName) {
  return http_get(server, '/lol/summoner/v4/summoners/by-name/' + encodeURIComponent(summonerName), 60 * 60 * 24)
    .then(summoner => {
      summoner.server = server;
      return summoner;
    }).catch(e => {
      if (e.message.includes('HTTP error 404')) return null;
      else throw e;
    });
}

async function getActiveGame(server, summonerId) {
  return http_get(server, '/lol/spectator/v4/active-games/by-summoner/' + summonerId)
    .catch(e => {
      if (e.message.includes('HTTP error 404')) return null;
      else throw e;
    });
}

async function getPlayerInfo(server, summonerId, summonerName, championId) {
  return Promise.all([
      getChampionName(championId),
      getMastery(server, summonerId, championId),
      getMatches(server, summonerId)
    ]).then(results => {
      return {
        id: summonerId,
        summoner: summonerName,
        champion: results[0],
        mastery: results[1],
        matches: results[2]
      };
    })
}

async function getMastery(server, summonerId, championId) {
  return http_get(server, '/lol/champion-mastery/v4/champion-masteries/by-summoner/' + summonerId + '/by-champion/' + championId, 60 * 60)
    .then(result => { return { level: result.championLevel, points: result.championPoints }; })
    .catch(e => {
      if (e.message.includes('HTTP error 404')) return { level: 0, points: 0 };
      else throw e;
    });
}

async function getMatches(server, summonerId) {
  return getPuuid(server, summonerId)
    .then(puuid => http_get(getBasicServer(server), '/lol/match/v5/matches/by-puuid/' + puuid + '/ids?start=0&count=100', 60 * 60))
    .then(match_ids => match_ids.slice(0, 45)) // cant make too many calls to the API, so lets limit a bit
    .then(match_ids => Promise.all(match_ids.map(getMatch)));
}

async function getPuuid(server, summonerId) {
  return http_get(server, '/lol/summoner/v4/summoners/' + summonerId, 60 * 60).then(result => result.puuid);
}

async function getMatch(match_id) {
  return http_get(getBasicServer(match_id.substring(0, match_id.indexOf('_')).toLowerCase()), '/lol/match/v5/matches/' + match_id, 60 * 60).then(match => match.info);
}

function getBasicServer(server) {
  switch(server) {
    case 'br1': return 'americas';
    case 'eun1': return 'europe';
    case 'euw1': return 'europe';
    case 'jp1': return 'asia';
    case 'kr': return 'asia';
    case 'la1': return 'americas';
    case 'la2': return 'americas';
    case 'na1': return 'americas';
    case 'oc1': return 'sea';
    case 'ru': return 'europe';
    case 'tr1': return 'europe';
    default: throw new Exception('unknown server ' + server);
  }
}

async function getChampionName(id) {
  return curl.request({ method: 'GET', hostname: 'ddragon.leagueoflegends.com', path: '/api/versions.json', cache: 60 })
    .then(versions => versions[0])
    .then(version => curl.request({ method: 'GET', hostname: 'ddragon.leagueoflegends.com', path: `/cdn/${version}/data/en_US/champion.json`, cache: 60 * 60 * 24 }))
    .then(result => result.data)
    .then(list => {
      for (let champion in list) {
        if (list[champion].key == id) return list[champion].name;
      }
      return null;
    });
}

function getSummonerSpellName(id) {
  // https://darkintaqt.com/blog/league-spell-id-list/
  switch(id) {
    case 21: return "Barrier";
    case 1: return "Cleanse";
    case 14: return "Ignite"
    case 3: return "Exhaust";
    case 4: return "Flash";
    case 6: return "Ghost";
    case 7: return "Heal";
    case 13: return "Clarity";
    case 30: return "To the King!";
    case 31: return "Poro Toss";
    case 11: return "Smite";
    case 39: return "Mark";
    case 32: return "Mark";
    case 12: return "Teleport";
    case 54: undefined; // Placeholder
    case 55: undefined; // Placeholder and Attack-Smite
    default: return undefined;
  }
}

function median(values) {
  values = values.sort((a, b) => a - b);
  let half = Math.floor(values.length / 2);
  if (values.length % 2 == 0) return (values[half-1] + values[half]) / 2;
  else return values[half];
}

const tiers = [ 'IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER' ].reverse();
const tier_colors = [ 0x504c4c, 0x834a12, 0xa5a5a5, 0xffae00, 0x94b464, 0x70a1b1, 0x9d70b1, 0xa57365, 0x0c3c77 ].reverse();
const queues = [ 'RANKED_SOLO_5x5', 'RANKED_FLEX_SR' ];

async function updateRankedRoles(guild_id, user_id) {
  let roles_key = 'roles:activity:League of Legends:guild:' + guild_id;
  let roles = await memory.get(roles_key, null);
  if (!roles) roles = {};
  let all_roles = await discord.guild_roles_list(guild_id).then(roles => roles.map(role => role.id));
  for(let queue of queues) {
    if (!roles[queue]) roles[queue] = {};
    for (let tier of tiers) {
      if (!roles[queue][tier] || !all_roles.includes(roles[queue][tier])) roles[queue][tier] = await createRole(guild_id, queue, tier);
    }
  }
  await memory.set(roles_key, roles);
  
  let summoners = await resolveAccount(user_id);
  if (summoners.length == 0) return;
  let member = await discord.guild_member_retrieve(guild_id, user_id);
  let leagues = await Promise.all(summoners.map(summoner => getLeagues(summoner.server, summoner.id))).then(leagues => leagues.reduce((a1, a2) => a1.concat(a2), []));
  for (let queue of queues) {
    for (let tier of tiers) {
      let role_id = roles[queue][tier];
      let actual = member.roles.includes(role_id);
      let expected = leagues.some(league => league.queueType == queue && league.tier == tier);
      if (!actual && expected) await discord.guild_member_role_assign(guild_id, user_id, role_id);
      if (actual && !expected) await discord.guild_member_role_unassign(guild_id, user_id, role_id);
    }
  }
}

async function createRole(guild_id, queue, tier) {
  return discord.guild_role_create(guild_id, createRoleName(queue, tier), '0', true, true, tier_colors[tiers.indexOf(tier)]).then(role => role.id);
}

function createRoleName(queue, tier) {
  return 'League of Legends ' + prettifyQueueName(queue) + ' ' + prettify(tier);
}

function prettifyQueueName(queue) {
  switch(queue) {
    case 'RANKED_SOLO_5x5': return 'Solo/Duo';
    case 'RANKED_FLEX_SR': return 'Flex'
    default: prettify(queue);
  }
}

function prettify(string) {
  return string.replace(/_/g, ' ')
    .split(' ')
    .map(token => token.length > 0 ? token.substring(0, 1).toUpperCase() + token.substring(1).toLowerCase() : token)
    .join(' ');
}

async function getLeagues(server, summonerId) {
  /*
  [
    {
        "leagueId": "9a68a5ce-2dd7-4ddd-934b-57c702f23684",
        "queueType": "RANKED_SOLO_5x5",
        "tier": "BRONZE",
        "rank": "I",
        "summonerId": "TwizGjjBJI8bVd9WPrv0WN2raDn_AkA8f559glnvse36MRM",
        "summonerName": "Kagami Doll",
        "leaguePoints": 18,
        "wins": 47,
        "losses": 54,
        "veteran": false,
        "inactive": false,
        "freshBlood": false,
        "hotStreak": false
    }
  ]
  */
  return http_get(server, '/lol/league/v4/entries/by-summoner/' + summonerId, 60);
}

module.exports = { getInformation, getSummoner, updateRankedRoles }










