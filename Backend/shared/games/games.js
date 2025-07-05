const troll = require('./troll.js');
const rdro = require('./rdro.js');
const lol = require('./lol.js');
const wow = require('./wow.js');
const epicgames = require('./epicgames.js');
const phasmophobia = require('./phasmophobia.js');
const hitman = require('./hitman.js');
const apex = require('./apex.js');
const ksp = require('./ksp.js');
const fortnite = require('./fortnite.js');

async function getActivityEmergencyNotification(name, details, state, user_name) {
  if (name === 'Red Dead Redemption 2') {
    return rdro.getEmergency(details, state, user_name);
  } else {
    return null;
  }
}

async function getActivityHint(name, details, state, user_id) {
  if (name === 'Red Dead Redemption 2' || name.toLowerCase() === 'rdr2' || name.toLowerCase() === 'rdro') {
    return rdro.getInformation(3);
  } else if (name === 'Epic Games' || name === 'Epic Games Launcher' || name === 'Epic Games Store') {
    return epicgames.getInformation();
  } else if (name.startsWith('Phasmophobia')) {
    return phasmophobia.getInformation(name.split(' ').slice(1).join(' '));
  } else if (name.toLowerCase().startsWith('hitman')) {
    return hitman.getInformation(name.split(' ').slice(1).join(' '));
  } else if (name == 'Apex Legends') {
    return apex.getInformation();
  } else if (name == 'Fortnite') {
    return fortnite.getInformation();
  } else if (name == 'Kerbal Space Program' || name == 'Kerbal Space Program 2') {
    return ksp.getInformation();
  } else {
    return null;
  }
}

async function updateRankedRoles(name, guild_id, user_id) {
  if (name == 'Apex Legends') {
    return apex.updateRankedRoles(guild_id, user_id);
  } else if (name == 'Fortnite') {
    return fortnite.updateRankedRoles(guild_id, user_id);
  }
}

module.exports = { getActivityHint, getActivityEmergencyNotification, updateRankedRoles }
