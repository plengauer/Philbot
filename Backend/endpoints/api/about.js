const process = require('process');
const fs = require('fs');
const discord = require('../../shared/discord.js');

async function handle() {
  let me = await discord.me();
  let about = ('' + fs.readFileSync('./about.txt'))
    .replace(/\$\{name\}/g, `${me.username}`)
    .replace(/\$\{version\}/g, JSON.parse('' + fs.readFileSync('package.json')).version)
    .replace(/\$\{link_code\}/g, `this <a href="/code">link</a>`)
    .replace(/\$\{link_discord_add\}/g, `this <a href="/invite">link</a>`)
    .replace(/\$\{link_monitoring\}/g, `this <a href="/monitoring">link</a>`)
    .replace(/\*\*(.*)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<p/>');
  return {
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: `<html><head><title>${me.username} About</title></head><body>${about}</body></html>`
  };
}

module.exports = { handle }
