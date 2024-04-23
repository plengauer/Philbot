const process = require('process');

async function handle() {
  return {
    status: 301,
    headers: { 'location': process.env.CODE_URL },
    body: 'Moved Permanently'
  };
}

module.exports = { handle }
