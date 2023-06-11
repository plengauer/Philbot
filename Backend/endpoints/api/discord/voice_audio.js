const message_create = require('./message_create.js');
const curl = require('../../../shared/curl.js');

async function handle(payload) {
  return handle0(payload.guild_id, payload.channel_id, payload.user_id, payload.nonce, payload.duration_secs).then(() => undefined);
}

async function handle0(guild_id, channel_id, user_id, nonce, duration_secs) {
  if (duration_secs < 0.25) return;
  return message_create.handle({
    guild_id: guild_id,
    channel_id: channel_id,
    author: { id: user_id },
    attachments: [{
      duration_secs: duration_secs,
      url: `http://127.0.0.1:` + (process.env.VOICE_PORT ?? '12345') + `/audio/guild/${guild_id}/channel/${channel_id}/user/${user_id}/nonce/${nonce}`
    }],
    flags: 1 << 31
  });
}

module.exports = { handle }
