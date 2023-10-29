const discord = require('../../../shared/discord.js');
const memory = require('../../../shared/memory.js');
const synchronized = require('../../../shared/synchronized.js');

async function handle(payload) {
  const threshold = 1000 * 60 * 60 * 24;
  let now = new Date();
  let guild_id = payload.guild_id;
  let channel_id = payload.channel_id;
  let user_id = payload.user_id;
  
  if (guild_id) return;

  return synchronized.locked(`reaction:typing:channel:${channel_id}`, async () => {
    let messages = await discord.messages(channel_id);
    let is_too_recent = messages.some(message => message.author.id == user_id && new Date(message.timestamp).getTime() > now.getTime() - threshold);
    if(is_too_recent) return;

    const key = `mute:auto:typing:channel:${channel_id}`;
    if (await memory.get(key, false)) return;
    await memory.set(key, true, 60 * 60);

    await discord.post(channel_id, '👀');
  });
}

module.exports = { handle }
  
