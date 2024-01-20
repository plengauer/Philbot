const fs = require('fs');
const discord = require('../../shared/discord.js');

async function handle() {
  let me = await discord.me();
  let privacy = ('' + fs.readFileSync('./privacy.txt'));
  return {
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: `<html><head><title>${me.username} Privacy</title></head><body>${privacy}</body></html>`
  };
}

module.exports = { handle }
