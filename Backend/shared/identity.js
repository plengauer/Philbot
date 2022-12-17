const process = require('process');

function getRootURL() {
  return process.env.PUBLIC_URL;
}

module.exports = { getRootURL }
