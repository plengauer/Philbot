const os = require('os');
const fs = require('fs');
const media = require('../../shared/media.js');
const discord = require('../../shared/discord.js');
const curl = require('../../shared/curl.js');

async function handle() {
  let me = await discord.me();
  let download = await curl.request({ hostname: 'cdn.discordapp.com', path: `/avatars/${me.id}/${me.avatar}.png`, stream: true });
  let icon = await new Promise(resolve => {
    let temporary_filename = os.tmpdir() + '/philbot.' + me.id + '.' + me.avatar + '.favicon.ico';
    if (fs.existsSync(temporary_filename)) {
      resolve(fs.createReadStream(temporary_filename));
    } else {
      let convertion = media.ffmpeg([ '-i', 'pipe:0', temporary_filename ]);
      download.pipe(convertion.stdin);
      convertion.on('exit', () => resolve(fs.createReadStream(temporary_filename)));
    }
  });
  return { status: 200, headers: { 'content-type': 'image/vnd.microsoft.icon' }, body: icon };
}

module.exports = { handle }