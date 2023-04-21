const memory = require('./memory.js');

function list() {
  return [
      'player',
      'repeating events',
      'tournament',
      'raid protection',
      'role management',
      'sticky nicknames',
      'ranked game roles',
      'mirror'
    ];
}

function key(guild_id, feature) {
  return `config:feature:guild:${guild_id}:name:${feature}`;
}

async function setActive(guild_id, feature, on) {
  return memory.set(key(guild_id, feature), on);
}

async function isActive(guild_id, feature) {
  return memory.get(key(guild_id, feature), false);
}

module.exports = { list, isActive, setActive }
