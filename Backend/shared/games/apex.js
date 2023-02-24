const troll = require('./troll.js');

async function getInformation() {
  return troll.getInformation();
}

function getConfigHint() {
  return {
    text: 'I cannot determine your in-game name. If you want me to give you hints about your current game, tell me EA name.'
      + ' Respond with \'configure Apex Legends NoobSlayerXXX\', filling in your in-game EA name.'
      + ' You can list more one name, separate tje, with \';\'.',
    ttl: 60 * 60 * 24 * 7
  };
}

async function updateRankedRoles(guild_id, user_id) {

}

module.exports = { getInformation, updateRankedRoles }

















