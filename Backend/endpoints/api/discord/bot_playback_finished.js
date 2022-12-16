const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode');
const statistics = require('../../../shared/statistics.js');
const player = require('../../../shared/player.js');

////// UNDER CONSTRUCTION (this will currently be never called)

async function handle(payload) {
  return Promise.all([
    statistics.record(`trigger:discord.bot.playback.finished:guild:${payload.guild_id}`)
    (Math.random() < 0.99 ? player.playNext(payload.guild_id, null) : player.play(payload.guild_id, null, null, 'rick roll'))
  ]).then(() => undefined);
}

module.exports = { handle }