const fs = require('fs');

function getRootURL() {
  return process.env.PUBLIC_URL;
}

module.exports = { getRootURL }
