const memory = require('./memory.js');
const discord = require('./discord.js');
const permissions = require('./permissions.js');

//TODO dedicated referees, that are circled through, and the method we use now are only "auxiliary"
//TODO use embeds for annoucnements
//TODO use components for referees and maybe even more stuff
//TODO synchronize

async function write(guild_id, tournament) {
  return tournament ? memory.set('tournament:guild:' + guild_id, tournament) : memory.unset('tournament:guild:' + guild_id);
}

async function read(guild_id) {
  return memory.get('tournament:guild:' + guild_id, null);
}

async function create(guild_id, name, game_masters, team_size, locations, length) {
  let date = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  let start_time = ''
    + date.getUTCFullYear()
    + '-' + ((date.getUTCMonth() + 1) < 10 ? '0' : '') + (date.getUTCMonth() + 1)
    + '-' + (date.getUTCDate() < 10 ? '0' : '') + date.getUTCDate()
    + 'T' + (date.getUTCHours() < 10 ? '0' : '') + date.getUTCHours()
    + ':' + (date.getUTCMinutes() < 10 ? '0' : '') + date.getUTCMinutes()
    + ':00+00:00';

  let category = await discord.guild_channel_create(guild_id, name, undefined, 4).then(category => category.id);
  let channel = await discord.guild_channel_create(guild_id, 'general', category, 0).then(channel => channel.id);
  let event = await discord.scheduledevent_create(guild_id, channel_id, name, '', start_time).then(event => event.id);
  let tournament = {
    name: name,
    category: category,
    channel: channel,
    event: event,
    game_masters: game_masters,
    team_size: team_size,
    locations: locations,
    length: length,
    teams: [],
    players: [],
    matches: []
  };
  await write(guild_id, tournament);
  await Promise.all(tournament.game_masters.map(game_master => discord.try_dms(game_master, `The tournament **${tournament.name}** has been created. Pls edit the event to the correct time and share it ` + discord.scheduledevent_link_create(guild_id, event) + '.')));
  return true;
}

async function _delete(guild_id, user_id) {
  await write(guild_id, null);
  await Promise.all(tournament.game_masters.map(game_master => discord.try_dms(game_master, `The tournament **${tournament.name}** has been deleted.`)));
  return true;
}

function random_int(limit) {
  return Math.floor(Math.random() * limit);
}

function random_element(array) {
  return array[random_int(array.length)];
}

function create_matches(length, locations, teams, players_per_team, referees) {
  if (length <= 0 || teams < 2) return [];
  
  let expected_matches = length * locations;
  while (expected_matches % teams != 0) expected_matches -= 1;
  let expected_matches_per_team = Math.floor(expected_matches * 2 / teams);
  let expected_matches_per_position = expected_matches_per_team / 2;
  let expected_matches_per_location = expected_matches / locations;
  
  let matches = [];
  for (let i = 0; i < expected_matches; i++) matches.push({ id: i, team1: -1, team2: -1, location: null, referee: null});
  
  again: for(;;) {
    // generate random schedule
    for (let m = 0; m < matches.length; m++) {
      matches[m].location = m % locations;
      matches[m].team1 = random_int(teams);
      matches[m].team2 = random_int(teams);
      matches[m].referee = random_element(referees);
    }
    
    // check if no team fight itself
    if (matches.some(match => match.team1 == match.team2)) continue again;
    
    // check if equal count of matches per team
    for (let team = 0; team < teams; team++) {
      if (matches.filter(match => match.team1 == team || match.team2 == team).length != expected_matches_per_team) continue again;
    }
    
    // check if equal distribution of team positions
    for (let team = 0; team < teams; team++) {
      if (matches.filter(match => match.team1 == team).length != expected_matches_per_position) continue again;
      if (matches.filter(match => match.team2 == team).length != expected_matches_per_position) continue again;
    }
    
    // check if every team at max once per slot (parallel locations)
    // TODO the following doesnt work if there are more locations than teams * 2, because then it always fails
    /*
    for (let slot = 0; slot < matches.length / locations; slot++) {
      let teams = new Set();
      for (let m = slot * locations; m < (slot+1) * locations; slot++) {
        if (teams.has(matches[m].team1) || teams.has(matches[m].team2)) continue again;
        teams.add(matches[m].team1);
        teams.add(matches[m].team2);
      }
    }
    */
    
    // check if equal (approx) distribution of locations
    // automatic due to algorithm
    
    // check if referee is one of the teams
    if (teams > 2 && matches.some(match => players_per_team[match.team1].includes(match.referee) || players_per_team[match.team2].includes(match.referee))) continue again;
    
    // check if equal (approx) distribution of location per team
    // random, good enough (for now, stretch though)
    
    // check if equal distribution of teams fighting each other
    // random, good enough (for now)
    
    // check if equal distribution of position and location per team
    // random, good enough (for now)
    
    // check parallelity
    
    return matches;
  }
}

async function define_team(guild_id, user_id, name, players) {
  let tournament = await read(guild_id);
  if (!tournament) return false;
  if (!tournament.game_masters.includes(user_id)) return false;
  let all_players = await get_all_involved_users(tournament);
  if (players.some(player => !all_players.includes(player))) return false;
  if (tournament.active) return false;
  if (tournament.teams.some(team => team.players.some(player => players.includes(player)))) return false;
  let id = tournament.teams.length;
  tournament.teams.push({id: id, name: name, players: players});
  recompute_matches(tournament);
  await write(guild_id, tournament);
  await Promise.all(tournament.game_masters.map(game_master => discord.try_dms(game_master, `Team ${id} "${name}" has been defined as ` + players.map(player => `<@${player}>`).join(', ') + `, the schedule has been adjusted.`)));
  return true;
}

async function dissolve_team(guild_id, user_id, id) {
  let tournament = await read(guild_id);
  if (!tournament) return false;
  if (!tournament.game_masters.includes(user_id)) return false;
  if (tournament.active) return false; //TODO in theory we could do that and just provide automatic wins ...
  if (id < 0 || id >= tournament.teams.length) return false;
  let team = tournament.teams[id];
  tournament.teams = tournament.teams.slice(0, id).concat(tournament.teams.slice(id + 1, tournament.teams.length));
  for (let id = 0; id < tournament.teams.length; id++) tournament.teams[id].id = id;
  recompute_matches(tournament);
  await write(guild_id, tournament);
  for (let game_master of tournament.game_masters) {
    await discord.try_dms(game_master, `Team ${team.id} "${team.name}" has been dissolved (` + team.players.map(player => `<@${player}>`).join(', ') + `), the schedule has been adjusted.`);
  }
  return true;
}

function recompute_matches(tournament) {
  return tournament.matches = create_matches(
      tournament.length, tournament.locations.length, tournament.teams.length,
      tournament.teams.map(team => team.players),
      tournament.game_masters.concat(tournament.teams.filter(team => team.players.length > 0).map(team => team.players[0]))
    );
}

async function replace_player(guild_id, user_id, player_replaced, player_replacing) {
  let tournament = await read(guild_id);
  if (!tournament) return false;
  if (!tournament.game_masters.includes(user_id)) return false;
  let all_players = await get_all_interested_users(tournament);
  if (!all_players.includes(player_replacing)) return false;
  if (player_replaced == player_replacing) return true;
  for (let team of tournament.teams) {
    if (!team.players.includes(player_replaced)) continue;
    team.players = team.players.map(p => p == player_replaced ? player_replacing : p);
    if (team.role) {
      await update_role(guild_id, player_replaced, team.role, false);
      await update_role(guild_id, player_replacing, team.role, true);
    }
  }
  for (let match of tournament.matches) {
    match.referee = match.referee == player_replaced ? player_replacing : match.referee;
  }
  await write(guild_id, tournament);
  return true;
}

//TODO remove player that drops out, grant wins to all opponents in the past and auto wins into the future

async function prepare(guild_id, user_id) {
  let tournament = await read(guild_id);
  if (!tournament) return false;
  if (!tournament.game_masters.includes(user_id)) return false;
  if (tournament.teams.some(team => team.players.length != tournament.team_size)) {
    let text = 'Cannot prepare the tournament, not all teams are full. '
      + 'Incomplete teams are: ' + tournament.teams
        .filter(team => team.players.length != tournament.team_size)
        .map(team => team.name + ' (' + team.players.map(player => `<@${player}>`).join(', ') + ')')
        .join(', ') + '. '
      + 'Unassigned players are: ' + await discord.scheduledevent_users_list(guild_id, tournament.event).then(users => users.map(user => user.id))
        .filter(player => !tournament.teams.some(team => team.players.includes(player)))
        .map(player => `<@${player}>`)
        .join(', ') + '.';
    await Promise.all(tournament.game_masters.map(game_master => discord.post(game_master, text)));
    return false;
  }
  if (tournament.matches.length == 0) {
    await Promise.all(tournament.game_masters.map(game_master => discord.post(game_master, 'Cannot prepare the tournament, schedule is empty.')));
    return false;
  }

  // create roles
  await Promise.all([
    create_role(guild_id, tournament.name).then(role_id => tournament.role = role_id),
    create_role(guild_id, `${tournament.name} Game Master`).then(role_id => tournament.role_master = role_id),
    create_role(guild_id, `${tournament.name} Referee`).then(role_id => tournament.role_referee = role_id),
    Promise.all(tournament.teams.map(team => create_role(guild_id, `${tournament.name} Team ${team.name}`).then(role_id => team.role = role_id)))
  ]);

  // create all channels
  await Promise.all([
    create_channel(guild_id, tournament.category, 'Lobby', [ tournament.role ], [ tournament.role ], [ tournament.role_master ]).then(channel_id => tournament.lobby = channel_id),
    Promise.all(tournament.teams.map(team => create_channel(guild_id, tournament.category, `Team ${team.name}`, [ tournament.role ], [ team.role ], [ tournament.role_referee, tournament.role_master ]).then(channel_id => team.channel = channel_id)))
  ]);

  // assign roles to the right people
  await Promise.all([
    write(guild_id, tournament),
    get_all_involved_users(tournament).then(users => Promise.all(users.map(user => discord.assign_role(guild_id, user, tournament.role)))),
    Promise.all(tournament.game_masters.map(user => discord.assign_role(guild_id, user, tournament.role_master))),
    Promise.all(tournament.teams.map(team => Promise.all(team.players.map(player => discord.assign_role(guild_id, player, team.role))))),
  ]);
  
  // announce
  await Promise.all([
    // create pretty embed about the schedule
    discord.post(tournament.channel, '\**THE TOURNAMENT IS ABOUT TO BEGIN**\n\n<@&' + tournament.role + '> **JOIN NOW**'),
    Promise.all(get_all_involved_users(tournament).map(user_id => discord.guild_member_move(guild_id, user_id, tournament.lobby).catch(ex => {}))),
    Promise.all(get_all_involved_users(tournament).map(user_id => discord.try_dms(user_id, 'Hi. I will be your personal assistant for today\'s tournament. I will tell you when to be where. Stay tuned for updates.')
      .then(sent => sent ? undefined : discord.post('I cannot DM <@' + user_id + '>. To manage the tournament, pls allow me to send you messages (Settings -> Privacy & Safety -> Allow direct messages from server members).'))
    ))
  ]);

  return true;
}

async function create_channel(guild_id, category, name, listen_roles = [], speak_roles = [], admin_roles = []) {
  return discord.guild_channel_create(guild_id, name, category, 2)
    .then(result => result.id)
    .then(channel_id => Promise.all([
        discord.guild_channel_permission_overwrite(channel_id, guild_id, undefined, permissions.compile(permissions.all())),
        Promise.all(listen_roles.map(role_id => discord.guild_channel_permission_overwrite(channel_id, role_id, permissions.compile(['VIEW_CHANNELS', 'CONNECT']), undefined))),
        Promise.all( speak_roles.map(role_id => discord.guild_channel_permission_overwrite(channel_id, role_id, permissions.compile(['VIEW_CHANNELS', 'CONNECT', 'SPEAK', 'STREAM']), undefined))),
        Promise.all( admin_roles.map(role_id => discord.guild_channel_permission_overwrite(channel_id, role_id, permissions.compile(['VIEW_CHANNELS', 'CONNECT', 'SPEAK', 'STREAM', 'MUTE_MEMBERS', 'DEAFEN_MEMBERS', 'KICK_MEMBERS', 'MOVE_MEMBERS']), undefined)))
      ]).then(() => channel_id));
}

async function create_role(guild_id, name) {
  return discord.guild_role_create(guild_id, name).then(result => result.id);
}

async function start(guild_id, user_id) {
  let tournament = await read(guild_id);
  if (!tournament) return false;
  if (!tournament.game_masters.includes(user_id)) return false;
  if (tournament.active) return true;

  tournament.active = true;
  await write(guild_id, tournament);
  await discord.post(tournament.channel, '\**THE TOURNAMENT HAS STARTED**');
  await announce_upcoming_matches(tournament, guild_id);

  await Promise.all(get_all_active_players(tournament).map(player => 
    discord.guild_member_move(guild_id, player, team.channel)
      .catch(e => Promise.all(tournament.game_masters.map(game_master => discord.try_dms(game_master, `Player <@${player}> is not connected to any voice channel. Pls verify.`))))
  ));

  return true;
}

async function match_started(guild_id, user_id, match_id) {
  let tournament = await read(guild_id);
  if (!tournament) return false;
  if (!tournament.active) return false;
  if (match_id < 0 || tournament.matches.length <= match_id) return false;
  if (tournament.matches[match_id].referee != user_id && !tournament.game_masters.includes(user_id)) return false;

  tournament.matches[match_id].active = true;
  await write(guild_id, tournament);
 
  await announce_match_started(tournament, match_id);

  await Promise.all([
    announce_match_started(tournament, match_id),
    Promise.all(tournament.teams[tournament.matches[match_id].team1].players
      .map(player => discord.guild_member_move(guild_id, player, tournament.teams[tournament.matches[match_id].team1].channel)
        .catch(e => discord.try_dms(tournament.matches[match_id].referee, `Player <@${player}> is not connected to any voice channel. Pls verify and restart the match if needed.`))
    )),
    Promise.all(tournament.teams[tournament.matches[match_id].team2].players
      .map(player => discord.guild_member_move(guild_id, player, tournament.teams[tournament.matches[match_id].team2].channel)
        .catch(e => discord.try_dms(tournament.matches[match_id].referee, `Player <@${player}> is not connected to any voice channel. Pls verify and restart the match if needed.`))
    ))
  ])

  return true;
}

async function match_aborted(guild_id, user_id, match_id) {
  let tournament = await read(guild_id);
  if (!tournament) return false;
  if (!tournament.active) return false;
  if (match_id < 0 || tournament.matches.length <= match_id) return false;
  if (tournament.matches[match_id].referee != user_id && !tournament.game_masters.includes(user_id)) return false;
  if (!tournament.matches[match_id].active) return false;

  tournament.matches[match_id].active = false;
  await write(guild_id, tournament);
  await announce_match_aborted(tournament, match_id);
  return true;
}

async function match_completed(guild_id, user_id, match_id, team_id_winner) {
  let tournament = await read(guild_id);
  if (!tournament) return false;
  if (!tournament.active) return false;
  if (match_id < 0 || tournament.matches.length <= match_id) return false;
  if (team_id_winner < 0 || tournament.teams.length <= team_id_winner) return false;
  if (tournament.matches[match_id].referee != user_id && !tournament.game_masters.includes(user_id)) return false;
  if (!tournament.matches[match_id].active) return false;
  if (tournament.matches[match_id].winner && !tournament.game_masters.includes(user_id)) return false;

  tournament.matches[match_id].active = false;
  tournament.matches[match_id].winner = team_id_winner;
  await write(guild_id, tournament);

  await Promise.all([
    announce_match_result(tournament, match_id),
    discord.unassign_role(guild_id, tournament.matches[match_id].referee, tournament.role_referee),
    announce_upcoming_matches(tournament, guild_id),
  ]);
  
  if (tournament.matches.every(match => match.winner != null)) {
    await announce_tournament_result(tournament);
    await get_all_involved_users(tournament).then(users => users.map(user_id => discord.guild_member_move(guild_id, user_id, tournament.lobby)).catch(e => {}));
  }

  return true;
}

async function announce_match_started(tournament, match_id) {
  return Promise.all([
      Promise.all(tournament.game_masters.map(game_master => discord.try_dms(game_master,
        `Match ${match_id}, `
        + `**${tournament.teams[tournament.matches[match_id].team1].name}** vs **${tournament.teams[tournament.matches[match_id].team2].name}**,`
        + ' has been started.'
      ))),
      //TODO update components
      discord.try_dms(tournament.matches[match_id].referee,
        'The match you referee\'d has been started. '
        + `Use the command 'tournament complete match ${match_id} ${tournament.matches[match_id].team1}' or 'tournament complete match ${match_id} ${tournament.matches[match_id].team2}' to register the result. `
        + `In case anything goes wrong, use 'tournament abort match ${match_id}' to abort the match.`
      )
    ]);
}

async function announce_match_aborted(tournament, match_id) {
  return Promise.all([
      Promise.all(tournament.game_masters.map(game_master => discord.try_dms(game_master,
        `Match ${match_id}, `
        + `**${tournament.teams[tournament.matches[match_id].team1].name}** vs **${tournament.teams[tournament.matches[match_id].team2].name}**,`
        + ' has been aborted.'
      ))),
      //TODO update components
      discord.try_dms(tournament.matches[match_id].referee, 'The match you referee\'d has been aborted.')
    ]);
}

async function announce_match_result(tournament, match_id) {
  return Promise.all([
      Promise.all(tournament.game_masters.map(game_master => discord.try_dms(game_master,
        `Match ${match_id}, `
        + `**${tournament.teams[tournament.matches[match_id].team1].name}** vs **${tournament.teams[tournament.matches[match_id].team2].name}**,`
        + ' has been completed.'
      ))),
      discord.try_dms(tournament.matches[match_id].referee, 'The match you referee\'d has been completed.'),
      discord.post(tournament.channel, 
        `Match ${match_id}, `
        + `**${tournament.teams[tournament.matches[match_id].team1].name}** vs **${tournament.teams[tournament.matches[match_id].team2].name}**`
        + ` in **${tournament.locations[tournament.matches[match_id].location]}**, has been completed. `
        + `The winner is **${tournament.teams[tournament.matches[match_id].winner].name}**!`
        )
    ]);
}

async function announce_upcoming_matches(tournament, guild_id) {
  let promises = [];
  let active_users = new Set()
  for (let match of tournament.matches) {
    if (match.winner) continue;
    let players = tournament.teams[match.team1].players.concat(tournament.teams[match.team2].players);
    let match_users = [ match.referee ].concat(players);
    if (match.active) {
      active_users.add(match_users);
      continue;
    }
    let next = match_users.every(user => !active_users.has(user));
    if (!active_users.has(match.referee)) {
      //TODO replace with component for referee to control the match
      promises.push(discord.try_dms(match.referee,
          `Next up, you are the referee in match ${match.id}: **${tournament.teams[match.team1].name}** vs **${tournament.teams[match.team2].name}** in **${tournament.locations[match.location]}**. `
          + (next ?
              `All players are free, pls check if they are ready and start the match when they are. `
              + `Use the command 'tournament start match ${match.id}' when you have given the teams the signal to start.` :
              `Not all players are free yet, you will be notified.`
            )
        ));
      active_users.add(match.referee);
      if (next) {
        promises.push(discord.assign_role(guild_id, match.referee, tournament.role_referee));
      }
    }
    for (let player of players) {
      if (active_users.has(player)) continue;
      active_users.add(player);
      //TODO replace with component signaling person is ready
      promises.push(discord.try_dms(player,
          `Next up, you are playing in match ${match.id}: **${tournament.teams[match.team1].name}** vs **${tournament.teams[match.team2].name}** in **${tournament.locations[match.location]}**. `
          + (next ? `All players are free, pls get into position and wait for the referee <@${match.referee}> to give the start signal.` : `Not all players are free yet, you will be notified.`)
        ));
    }
    if (next) {
      //TODO replace with pretty embed
      promises.push(discord.post(tournament.channel,
        `Next up is match ${match.id}: `
        + `**${tournament.teams[match.team1].name}** (` + tournament.teams[match.team1].players.map(player => `<@${player}>`).join(', ') + `)`
        + ` vs `
        + `**${tournament.teams[match.team2].name}** (` + tournament.teams[match.team2].players.map(player => `<@${player}>`).join(', ') + `)`
        + ` in **${tournament.locations[match.location]}**`
        + ` with the referee <@${match.referee}>` 
        + `.`
      ));
    }
  }
  return Promise.all(promises);
}

async function announce_tournament_result(tournament) {
  let scores = compute_scores(tournament);
  let score_string = 'Score:\n' + tournament.teams.map(team => `\t${team.name}: ${scores[team.id]}`).join('\n');
  return Promise.all([
      Promise.all(tournament.game_masters.map(game_master => discord.try_dms(game_master, `\n**THE TOURNAMENT HAS BEEN COMPLETED**\n\n${score_string}`))),
      get_all_active_players(tournament).then(players => Promise.all(players.map(player => discord.try_dms(player,
          `**The tournament has been completed**. You have won `
          + scores[tournament.teams.findIndex(team => team.players.includes(player))]
          + ` matches and reached place #`
          + (countValuesHigher(scores, scores[tournament.teams.findIndex(team => team.players.includes(player))]) + 1)
          + `!`
        )))),
      //TODO replace with pretty embed!
      discord.post(tournament.channel, `\n**THE TOURNAMENT HAS BEEN COMPLETED**\n\n${score_string}\n\nThank you all for participating.`)
    ]);
}

async function get_all_interested_users(tournament) {
  return discord.scheduledevent_users_list(guild_id, tournament.event).then(users => users.map(user => user.id));
}

async function get_all_active_players(tournament) {
  return tournament.teams.map(team => team.players).reduce((t1, t2) => t1.concat(t2), []);
}

async function get_all_involved_users(tournament) {
  return Array.from(new Set(tournament.game_masters.concat(get_all_active_players(tournament)).concat(get_all_interested_users(tournament))));
}

function compute_scores(tournament) {
  let score_per_team = [];
  for (let team = 0; team < tournament.teams.length; team++) score_per_team.push(0);
  
  for (let match of tournament.matches) {
    if (!match.winner) continue;
    score_per_team[match.winner]++;
  }
  
  return score_per_team;
}

function countValuesHigher(array, value) {
  let count = 0;
  for (let i = 0; i < array.length; i++) {
    if (array[i] > value) count++;
  }
  return count;
}

module.exports = { create, _delete, replace_player, define_team, dissolve_team, prepare, start, match_started, match_aborted, match_completed }














