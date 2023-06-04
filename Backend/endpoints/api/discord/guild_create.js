const discord = require('../../../shared/discord.js');
const role_management = require('../../../shared/role_management.js');

async function handle(payload) {
  let guild_id = payload.id;
  if (new Date(payload.joined_at).getTime() >= Date.now() - 1000 * 10) {
    let guild = await discord.guild_retrieve(guild_id);
    if (guild.system_channel_id) {
      let me = await discord.me();
      await discord.post(values[0].system_channel_id, `Hi, I'm <@${me.id}>. I can play music, tell jokes, schedule weekly events, whatever you need. Type \'<@${me.id}> help\' to learn how to talk to me. I'm always around and happy to help.`);
    }
  } else {
    await role_management.update_all(guild_id);
  }
}

module.exports = { handle }
  
