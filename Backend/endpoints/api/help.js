const fs = require('fs');
const discord = require('../../shared/discord.js');

async function handle() {
  let me = await discord.me();
  let help = ('' + fs.readFileSync('./help.txt'))
    .replace(/\$\{about_instruction\}/g, 'See <a href="/about">about</a>')
    .replace(/\*\*\$\{name\}\*\*/g, `**${me.username}**`).replace(/\$\{name\}/g, `@${me.username}`)
    .replace(/\$\{notification_role\}/g, 'unknown')
    .replace(/\*\*(.*)\*\*/g, '<b>$1</b>')
    //.replace(/'(?<![a-zA-Z])(.*)'/g, '<code>$1</code>')
    .replace(/\n/g, '<p/>');
  for (let f = 0; f < help.length; f++) {
    if (help.charAt(f) == '\'' && (f == 0 || help.charAt(f - 1) == ' ')) {
      for (let t = f + 1; t < help.length; t++) {
        if (help.charAt(t) == '\'') {
          help = help.substring(0, f) + '<code>' + help.substring(f + 1, t) + '</code>' + help.substring(t + 1, help.length);
          break;
        }
      }
    }
  }
  return {
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: `<html><head><title>${me.username} Help</title></head><body>${help}</body></html>`
  };
}

module.exports = { handle }