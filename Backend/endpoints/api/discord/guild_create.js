const discord = require('../../../shared/discord.js');

async function handle(payload) {
  if (new Date(payload.joined_at).getTime() > Date.now() - 1000 * 10) {
    return undefined;
  }
  let guild_id = payload.guild_id;
  return Promise.all([
      discord.guild_retrieve(guild_id),
      discord.me()
    ]).then(values => values[0].system_channel_id ?
      discord.post(values[0].system_channel_id, `Hi, I'm <@${values[1].id}>. I can play music, tell jokes, schedule weekly events, whatever you need. Type \'<@${values[1].id}> help\' to learn how to talk to me. I'm always around and happy to help.`) :
      Promise.resolve()
    ).catch(ex => {
      span.setStatus({ code: opentelemetry.SpanStatusCode.ERROR });
      span.recordException(ex);
      throw ex;
    })
    .then(() => undefined);
}

module.exports = { handle }
  
