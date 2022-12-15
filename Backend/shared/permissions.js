const fs = require('fs');

const PERMISSIONS = [
  'CREATE_INVITE', // CREATE_INSTANT_INVITE
  'KICK_MEMBERS',
  'BAN_MEMBERS',
  'ADMINISTRATOR',
  'MANAGE_CHANNELS',
  'MANAGE_SERVER', // MANAGE_GUILD
  'ADD_REACTIONS',
  'VIEW_AUDIT_LOG',
  'PRIORITY_SPEAKER',
  'STREAM',
  'VIEW_CHANNELS',
  'SEND_MESSAGES',
  'SEND_TTS_MESSAGES',
  'MANAGE_MESSAGES',
  'EMBED_LINKS',
  'ATTACH_FILES',
  'READ_MESSAGE_HISTORY',
  'MENTION_EVERYONE',
  'USE_EXTERNAL_EMOJIS',
  'VIEW_SERVER_INSIGHTS', // VIEW_GUILD_INSIGHTS
  'CONNECT',
  'SPEAK',
  'MUTE_MEMBERS',
  'DEAFEN_MEMBERS',
  'MOVE_MEMBERS',
  'USE_VAD',
  'CHANGE_NICKNAME',
  'MANAGE_NICKNAMES',
  'MANAGE_ROLES',
  'MANAGE_WEBHOOKS',
  'MANAGE_EMOJIS_AND_STICKERS',
  'USE_APPLICATION_COMMANDS',
  'REQUEST_TO_SPEAK',
  'MANAGE_EVENTS',
  'MANAGE_THREADS',
  'CREATE_PUBLIC_THREADS',
  'CREATE_PRIVATE_THREADS',
  'USE_EXTERNAL_STICKERS',
  'SEND_MESSAGES_IN_THREADS',
  'USE_EMBEDDED_ACTIVITIES',
  'MODERATE_MEMBERS'
];

function compile(names) {
  return '' + names.map(name => name2flag(name)).reduce((flags, flag) => flags | (BigInt(1) << BigInt(flag)), BigInt(0));
}

function decompile(flags) {
  return PERMISSIONS.filter(permission => ((BigInt(flags) >> BigInt(name2flag(permission))) & BigInt(1)) != BigInt(0));
}

function all() {
  return PERMISSIONS;
}

function required(features = []) {
  let permissions = JSON.parse(fs.readFileSync('./discord_permissions.json'));
  return Array.from(new Set([ 'minimum' ].concat(features).map(feature => permissions[feature]).reduce((a1, a2) => a1.concat(a2), [])));
}

function flag2name(flag) {
  return PERMISSIONS[flag];
}

function name2flag(name) {
  let flag = PERMISSIONS.indexOf(name);
  if (flag < 0) throw new Error('Unknown permission: ' + name);
  return flag;
}

module.exports = { compile, decompile, all, required }
