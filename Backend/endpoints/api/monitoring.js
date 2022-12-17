const process = require('process');

async function handle() {
  return {
    status: 302,
    headers: { 'Content-Type': 'text/plain', 'Location': process.env.LINK_OBSERVABILITY },
    body: 'Found'
  };
}

module.exports = { handle }
