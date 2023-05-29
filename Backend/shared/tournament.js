const memory = require('./memory.js');
const discord = require('./discord.js');
const permissions = require('./permissions.js');
const synchronized = require('./synchronized.js');

//TODO dedicated referees, that are circled through, and the method we use now are only "auxiliary"
//TODO re-introduce use embeds for annoucnements
//TODO use components for admin stuff (team setup)
//TODO how to bring game masters to create teams, maybe use some component to do it
//TODO think about what can do wrong. reset match, replace player, auto wins

async function write(tournament) {
  return memory.set('tournament:guild:' + tournament.guild_id, tournament);
}

async function read(guild_id) {
  return memory.get('tournament:guild:' + guild_id, null);
}

async function locked(guild_id, func) {
  return synchronized.locked('tournament:guild:' + guild_id, () => func());
}

async function create(guild_id, name, date, game_masters, team_size, locations, length) {
  return locked(guild_id, () => create_0(guild_id, name, date, game_masters, team_size, locations, length));
}

async function create_0(guild_id, name, date, game_masters, team_size, locations, length) {
  let tournament = await read(guild_id);
  if (tournament) throw new Error();
  let category = await discord.guild_channel_create(guild_id, name, undefined, 4).then(category => category.id);
  let channel = await discord.guild_channel_create(guild_id, 'general', category, 0).then(channel => channel.id);
  let event = await discord.scheduledevent_create(guild_id, null, name, '', date).then(event => event.id);
  tournament = {
    name: name,
    guild_id: guild_id,
    category_id: category,
    channel_id: channel,
    event_id: event,
    game_masters: game_masters,
    team_size: team_size,
    locations: locations,
    length: length,
    teams: [],
    matches: []
  };
  await write(tournament);
  await Promise.all(tournament.game_masters.map(game_master => discord.try_dms(game_master, `The tournament **${tournament.name}** has been created. Pls share the event ` + discord.scheduledevent_link_create(guild_id, tournament.event_id) + ' to register.')));
}

async function _delete(guild_id, user_id) {
  return locked(guild_id, () => _delete_0(guild_id, user_id));
}

async function _delete_0(guild_id, user_id) {
  let tournament = await read(guild_id);
  await memory.unset('tournament:guild:' + guild_id);
  await Promise.all(tournament.game_masters.map(game_master => discord.try_dms(game_master, `The tournament **${tournament.name}** has been deleted.`)));
}

function random_int(limit) {
  return Math.floor(Math.random() * limit);
}

function random_element(array) {
  return array[random_int(array.length)];
}

function create_matches(length, locations, teams, players_per_team, referees, use_active_player_referees) {
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
    if (!use_active_player_referees && matches.some(match => players_per_team[match.team1].includes(match.referee) || players_per_team[match.team2].includes(match.referee))) continue again;
    
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
  return locked(guild_id, () => define_team_0(guild_id, user_id, name, players));
}

async function define_team_0(guild_id, user_id, name, players) {
  let tournament = await read(guild_id);
  if (!tournament) throw new Error();
  if (!tournament.game_masters.includes(user_id)) throw new Error();
  let all_players = await get_all_interested_users(tournament);
  if (players.some(player => !all_players.includes(player)) && !process.env.TOURNAMENT_INTERESTED_PLAYER_OVERRIDE) throw new Error();
  if (tournament.active) throw new Error();
  if (tournament.teams.some(team => team.players.some(player => players.includes(player)))) throw new Error();
  let id = tournament.teams.length;
  tournament.teams.push({id: id, name: name, players: players});
  recompute_matches(tournament);
  await write(tournament);
  await Promise.all(tournament.game_masters.map(game_master => discord.try_dms(game_master, `Team ${id} "${name}" has been defined as ` + players.map(player => `<@${player}>`).join(', ') + `, the schedule has been adjusted.`)));
}

async function dissolve_team(guild_id, user_id, name) {
  return locked(guild_id, () => dissolve_team_0(guild_id, user_id, name));
}

async function dissolve_team_0(guild_id, user_id, name) {
  let tournament = await read(guild_id);
  if (!tournament) throw new Error();
  if (!tournament.game_masters.includes(user_id)) throw new Error();
  if (tournament.active) throw new Error(); //TODO in theory we could do that and just provide automatic wins ...
  let team = tournament.teams.find(team => team.name == name);
  tournament.teams = tournament.teams.filter(team => team.name != name);
  for (let id = 0; id < tournament.teams.length; id++) tournament.teams[id].id = id;
  recompute_matches(tournament);
  await write(tournament);
  await Promise.all(tournament.game_masters.map(game_master => discord.try_dms(game_master, `Team "${team.name}" has been dissolved (` + team.players.map(player => `<@${player}>`).join(', ') + `), the schedule has been adjusted.`)));
}

function recompute_matches(tournament) {
  let referees = tournament.game_masters.concat(tournament.teams.filter(team => team.players.length > 0).map(team => team.players[0]));
  return tournament.matches = create_matches(
      tournament.length, tournament.locations.length, tournament.teams.length,
      tournament.teams.map(team => team.players), referees,
      referees.length - 2 * location < location,
    );
}

//TODO remove player that drops out, grant wins to all opponents in the past and auto wins into the future

async function prepare(guild_id, user_id) {
  return locked(guild_id, () => prepare_0(guild_id, user_id));
}

async function prepare_0(guild_id, user_id) {
  let tournament = await read(guild_id);
  if (!tournament) throw new Error();
  if (!tournament.game_masters.includes(user_id)) throw new Error();
  if (tournament.teams.some(team => team.players.length != tournament.team_size)) {
    let text = 'Cannot prepare the tournament, not all teams are full. '
      + 'Incomplete teams are: ' + tournament.teams
        .filter(team => team.players.length != tournament.team_size)
        .map(team => team.name + ' (' + team.players.map(player => `<@${player}>`).join(', ') + ')')
        .join(', ') + '. '
      + 'Unassigned players are: ' + (await get_all_interested_users(tournament)).map(user => user.id)
        .filter(player => !tournament.teams.some(team => team.players.includes(player)))
        .map(player => `<@${player}>`)
        .join(', ') + '.';
    await Promise.all(tournament.game_masters.map(game_master => discord.post(game_master, text)));
    throw new Error();
  }
  if (tournament.matches.length == 0) {
    await Promise.all(tournament.game_masters.map(game_master => discord.post(game_master, 'Cannot prepare the tournament, schedule is empty.')));
    throw new Error();
  }

  // create roles
  await Promise.all([
    create_role(tournament.guild_id, tournament.name).then(role_id => tournament.role = role_id),
    create_role(tournament.guild_id, `${tournament.name} Game Master`).then(role_id => tournament.role_master = role_id),
    create_role(tournament.guild_id, `${tournament.name} Referee`).then(role_id => tournament.role_referee = role_id),
    Promise.all(tournament.teams.map(team => create_role(tournament.guild_id, `${tournament.name} Team ${team.name}`).then(role_id => team.role = role_id)))
  ]);

  // create all channels
  await Promise.all([
    create_channel(tournament.guild_id, tournament.category_id, 'Lobby', [ tournament.role ], [ tournament.role ], [ tournament.role_master ]).then(channel_id => tournament.lobby = channel_id),
    Promise.all(tournament.teams.map(team => create_channel(tournament.guild_id, tournament.category_id, `Team ${team.name}`, [ tournament.role ], [ team.role ], [ tournament.role_referee, tournament.role_master ]).then(channel_id => team.channel = channel_id)))
  ]);

  // assign roles to the right people, and change event
  await Promise.all([
    write(tournament),
    discord.scheduledevent_update_location(guild_id, tournament.event_id, tournament.lobby),
    get_all_involved_users(tournament).then(users => Promise.all(users.map(user => discord.guild_member_role_assign(tournament.guild_id, user, tournament.role)))),
    get_all_active_players(tournament).then(players => Promise.all(players.map(player => discord.guild_member_role_assign(tournament.guild_id, player, team.role)))),
    Promise.all(tournament.game_masters.map(user => discord.guild_member_role_assign(tournament.guild_id, user, tournament.role_master))),
  ]);
  
  // announce
  await Promise.all([
    // create pretty embed about the schedule
    discord.post(tournament.channel_id, '\**THE TOURNAMENT IS ABOUT TO BEGIN**\n\n<@&' + tournament.role + '> **JOIN NOW**'),
    Promise.all(get_all_involved_users(tournament).then(user_ids => user_ids.map(user_id => discord.guild_member_move(tournament.guild_id, user_id, tournament.lobby).catch(ex => {})))),
    Promise.all(get_all_involved_users(tournament).then(user_ids => user_ids.map(user_id => discord.try_dms(user_id, 'Hi. I will be your personal assistant for today\'s tournament. I will tell you when to be where. Stay tuned for updates.')
      .then(sent => sent ? undefined : discord.post('I cannot DM <@' + user_id + '>. To manage the tournament, pls allow me to send you messages (Settings -> Privacy & Safety -> Allow direct messages from server members).'))
    )))
  ]);
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
  return locked(guild_id, () => start_0(guild_id, user_id));
}

async function start_0(guild_id, user_id) {
  let tournament = await read(guild_id);
  if (!tournament) throw new Error();
  if (!tournament.game_masters.includes(user_id)) throw new Error();
  if (tournament.active) throw new Error();

  tournament.active = true;
  await write(tournament);
  await discord.post(tournament.channel_id, '\**THE TOURNAMENT HAS STARTED**');
  await announce_upcoming_matches(tournament);

  await Promise.all(get_all_active_players(tournament).then(players => players.map(player => 
    discord.guild_member_move(tournament.guild_id, player, team.channel)
      .catch(e => Promise.all(tournament.game_masters.map(game_master => discord.try_dms(game_master, `Player <@${player}> is not connected to any voice channel. Pls verify.`))))
  )));
}

async function on_interaction(guild_id, user_id, interaction_id, interaction_token, data) {
  return locked(guild_id, () => on_interaction_0(guild_id, user_id, interaction_id, interaction_token, data));
}

async function on_interaction_0(guild_id, user_id, interaction_id, interaction_token, data) {
  if (data.custom_id.startsWith(`tournament.referee.`)) {
    let match_id = data.custom_id.split('.')[2];
    switch(data.custom_id.split('.')[3]) {
      case 'start': return match_start(guild_id, user_id, match_id).then(() => discord.interact(interaction_id, interaction_token));
      case 'abort': return match_abort(guild_id, user_id, match_id).then(() => discord.interact(interaction_id, interaction_token));
      case 'complete': return discord.interact(interaction_id, interaction_token, {
        type: 9,
        data: {
          "title": "Select Winner",
          "custom_id": `tournament.referee.${match_id}.complete.modal`,
          "components": [{
            "type": 1,
            "components": [{
              "type": 4,
              "custom_id": `tournament.referee.${match_id}.complete.winner`,
              "label": "Name of winning team",
              "style": 1,
              "min_length": 1,
              "max_length": 4000,
              "placeholder": "",
              "required": true
            }]
          }]
        }
      });
      case 'complete.modal': return match_complete(guild_id, user_id, data.components[0].components[0].value).then(() => discord.interact(interaction_id, interaction_token));
      default: throw new Error('Unknown interaction: ' + data.custom_id);
    }
  } else {
    throw new Error('Unknown interaction: ' + data.custom_id);
  }
}

async function match_start(guild_id, user_id, match_id) {
  let tournament = await read(guild_id);
  if (!tournament) throw new Error();
  if (!tournament.active) throw new Error();
  if (match_id < 0 || tournament.matches.length <= match_id) throw new Error();
  if (tournament.matches[match_id].referee != user_id && !tournament.game_masters.includes(user_id)) throw new Error();

  tournament.matches[match_id].active = true;
  await write(tournament);
 
  await Promise.all([
    announce_match_started(guild_id, tournament, match_id),
    Promise.all(tournament.teams[tournament.matches[match_id].team1].players
      .map(player => discord.guild_member_move(guild_id, player, tournament.teams[tournament.matches[match_id].team1].channel)
        .catch(e => discord.try_dms(tournament.matches[match_id].referee, `Player <@${player}> is not connected to any voice channel. Pls verify and restart the match if needed.`))
    )),
    Promise.all(tournament.teams[tournament.matches[match_id].team2].players
      .map(player => discord.guild_member_move(guild_id, player, tournament.teams[tournament.matches[match_id].team2].channel)
        .catch(e => discord.try_dms(tournament.matches[match_id].referee, `Player <@${player}> is not connected to any voice channel. Pls verify and restart the match if needed.`))
    ))
  ]);
}

async function match_abort(guild_id, user_id, match_id) {
  let tournament = await read(guild_id);
  if (!tournament) throw new Error();
  if (!tournament.active) throw new Error();
  if (match_id < 0 || tournament.matches.length <= match_id) throw new Error();
  if (tournament.matches[match_id].referee != user_id && !tournament.game_masters.includes(user_id)) throw new Error();
  if (!tournament.matches[match_id].active) throw new Error();

  tournament.matches[match_id].active = false;
  await write(tournament);
  await announce_match_aborted(tournament, match_id);
}

async function match_complete(guild_id, user_id, match_id, team_name_winner) {
  let tournament = await read(guild_id);
  if (!tournament) throw new Error();
  if (!tournament.active) throw new Error();
  if (match_id < 0 || tournament.matches.length <= match_id) throw new Error();
  if (tournament.teams.every(team => team.name != team_name_winner)) throw new Error();
  if (tournament.matches[match_id].referee != user_id && !tournament.game_masters.includes(user_id)) throw new Error();
  if (!tournament.matches[match_id].active) throw new Error();
  if (tournament.matches[match_id].winner && !tournament.game_masters.includes(user_id)) throw new Error();

  tournament.matches[match_id].active = false;
  tournament.matches[match_id].winner = tournament.teams.findIndex(team => team.name == team_name_winner);
  await write(tournament);

  await Promise.all([
    announce_match_result(tournament.guild_id, tournament, match_id),
    discord.guild_member_role_unassign(tournament.guild_id, tournament.matches[match_id].referee, tournament.role_referee),
    announce_upcoming_matches(tournament),
  ]);
  
  if (tournament.matches.every(match => match.winner != null)) {
    await announce_tournament_result(tournament);
    await get_all_involved_users(tournament).then(users => users.map(user_id => discord.guild_member_move(tournament.guild_id, user_id, tournament.lobby)).catch(e => {}));
  }
}

async function announce_match_started(tournament, match_id) {
  return Promise.all([
      Promise.all(tournament.game_masters.map(game_master => discord.try_dms(game_master,
        `Match ${match_id}, `
        + `**${tournament.teams[tournament.matches[match_id].team1].name}** vs **${tournament.teams[tournament.matches[match_id].team2].name}**,`
        + ' has been started.'
      ))),
      update_referee_interaction(tournament.guild_id, tournament, match_id),
      discord.try_dms(tournament.matches[match_id].referee, 'The match you referee\'d has been started.')
    ]);
}

async function announce_match_aborted(tournament, match_id) {
  return Promise.all([
      Promise.all(tournament.game_masters.map(game_master => discord.try_dms(game_master,
        `Match ${match_id}, `
        + `**${tournament.teams[tournament.matches[match_id].team1].name}** vs **${tournament.teams[tournament.matches[match_id].team2].name}**,`
        + ' has been aborted.'
      ))),
      update_referee_interaction(tournament, match_id),
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
      update_referee_interaction(tournament, match_id),
      discord.try_dms(tournament.matches[match_id].referee, 'The match you referee\'d has been completed.'),
      discord.post(tournament.channel_id, 
        `Match ${match_id}, `
        + `**${tournament.teams[tournament.matches[match_id].team1].name}** vs **${tournament.teams[tournament.matches[match_id].team2].name}**`
        + ` in **${tournament.locations[tournament.matches[match_id].location]}**, has been completed. `
        + `The winner is **${tournament.teams[tournament.matches[match_id].winner].name}**!`
        )
    ]);
}

async function announce_upcoming_matches(tournament) {
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
      await discord.try_dms(match.referee, `Next up, you are the referee in match ${match.id}: **${tournament.teams[match.team1].name}** vs **${tournament.teams[match.team2].name}** in **${tournament.locations[match.location]}**.`);
      if (next) {
        await discord.guild_member_role_assign(tournament.guild_id, match.referee, tournament.role_referee);
        await discord.try_dms(match.referee, `All players are free, pls check if they are ready and start the match when they are.`);
        await update_referee_interaction(tournament.guild_id, tournament, match.id);
      } else {
        await discord.try_dms(match.referee, `Not all players are free yet, you will be notified.`);
      }
      active_users.add(match.referee);
    }
    for (let player of players) {
      if (active_users.has(player)) continue;
      active_users.add(player);
      //TODO replace with component signaling person is ready and tell referee
      await discord.try_dms(player,
          `Next up, you are playing in match ${match.id}: **${tournament.teams[match.team1].name}** vs **${tournament.teams[match.team2].name}** in **${tournament.locations[match.location]}**. `
          + (next ? `All players are free, pls get into position and wait for the referee <@${match.referee}> to give the start signal.` : `Not all players are free yet, you will be notified.`)
        );
    }
    if (next) {
      await discord.post(tournament.channel_id,
        `Next up is match ${match.id}: `
        + `**${tournament.teams[match.team1].name}** (` + tournament.teams[match.team1].players.map(player => `<@${player}>`).join(', ') + `)`
        + ` vs `
        + `**${tournament.teams[match.team2].name}** (` + tournament.teams[match.team2].players.map(player => `<@${player}>`).join(', ') + `)`
        + ` in **${tournament.locations[match.location]}**`
        + ` with the referee <@${match.referee}>` 
        + `.`
      );
    }
  }
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
      discord.post(tournament.channel_id, `\n**THE TOURNAMENT HAS BEEN COMPLETED**\n\n${score_string}\n\nThank you all for participating.`)
    ]);
}

async function update_referee_interaction(tournament, match_id) {
  let match = tournament.matches[match_id];
  let text = `Match **${tournament.teams[match.team1].name}** vs **${tournament.teams[match.team1].name}**`;
  if (match.winner) {
    text += ` => **${tournament.teams[match.team1].winner}**`;
  }
  let components = create_referee_components(tournament, match_id);
  let channel_id = await discord.dms_channel_retrieve(match.referee).then(channel => channel.id);
  if (match.interaction_id) {
    await discord.message_update(channel_id, match.interaction_id, text, [], components);
  } else {
    tournament.interaction_id = await discord.post(channel_id, text, undefined, true, [], components).then(message => message.id);
  }
  await write(tournament);
}

async function create_referee_components(tournament, match_id) {
  let match = tournament.matches[match_id];
  return [{
    "type": 1,
    "components": [
      { type: 2, label:    'Start', style: 1, custom_id: `tournament.referee.${match_id}.start`   , disabled: match.active },
      { type: 2, label: 'Complete', style: 3, custom_id: `tournament.referee.${match_id}.complete`, disabled: !match.active || !!match.winner },
      { type: 2, label:    'Abort', style: 4, custom_id: `tournament.referee.${match_id}.abort`   , disabled: !match.active || !!match.winner },
    ]
  }];
}

async function get_all_interested_users(tournament) {
  return discord.scheduledevent_users_list(tournament.guild_id, tournament.event_id).then(users => users.map(user => user.id));
}

async function get_all_active_players(tournament) {
  return tournament.teams.map(team => team.players).reduce((t1, t2) => t1.concat(t2), []);
}

async function get_all_involved_users(tournament) {
  return Array.from(new Set(tournament.game_masters.concat(await get_all_active_players(tournament))));
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

async function replace_player(guild_id, user_id, player_replaced, player_replacing) {
  return locked(guild_id, () => replace_player_0(guild_id, user_id, player_replaced, player_replacing));
}

async function replace_player_0(guild_id, user_id, player_replaced, player_replacing) {
  let tournament = await read(guild_id);
  if (!tournament) throw new Error();
  if (!tournament.game_masters.includes(user_id)) throw new Error();
  let all_players = await get_all_interested_users(tournament);
  if (!all_players.includes(player_replacing)) throw new Error();
  if (player_replaced == player_replacing) throw new Error();
  for (let team of tournament.teams) {
    if (!team.players.includes(player_replaced)) continue;
    team.players = team.players.map(p => p == player_replaced ? player_replacing : p);
    if (team.role) {
      await update_role(tournament.guild_id, player_replaced, team.role, false);
      await update_role(tournament.guild_id, player_replacing, team.role, true);
    }
  }
  for (let match of tournament.matches) {
    match.referee = match.referee == player_replaced ? player_replacing : match.referee;
  }
  await write(tournament);
}

module.exports = { create, _delete, define_team, dissolve_team, prepare, start, on_interaction, replace_player }














