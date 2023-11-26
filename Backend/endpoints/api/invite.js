const process = require('process');
const permissions = require('../../shared/permissions.js');

async function handle() {
  let required = permissions.compile(permissions.required());
  return {
    status: 302,
    headers: { 'location': `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&scope=identify%20bot&permissions=${required}` },
    body: 'Found'
  };
}

module.exports = { handle }