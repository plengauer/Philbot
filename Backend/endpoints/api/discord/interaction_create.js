const discord = require('../../../shared/discord.js');
const curl = require('../../../shared/curl.js');
const player = require('../../../shared/player.js');

async function handle(payload) {
  let guild_id = payload.guild_id ?? await resolveGuildID(payload.member.user.id);
  let channel_id = payload.channel_id;
  switch(payload.data.custom_id) {
    case 'interaction.debug.ping': return discord.interact(payload.id, payload.token);
    case 'player.resume': return player.resume(guild_id).then(() => discord.interact(payload.id, payload.token));
    case 'player.pause': return player.pause(guild_id).then(() => discord.interact(payload.id, payload.token));
    case 'player.stop': return player.stop(guild_id).then(() => discord.interact(payload.id, payload.token));
    case 'player.next': return player.playNext(guild_id, undefined).then(() => discord.interact(payload.id, payload.token));
  }
}

async function resolveGuildID(user_id) {
  return memory.get(`voice_channel:user:${user_id}`, null).then(info => info ? info.guild_id : null);
}

module.exports = { handle }
  
