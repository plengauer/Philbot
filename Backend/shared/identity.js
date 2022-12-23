const process = require('process');
const curl = require('./curl.js');

async function getPublicURL() {
  return new Promise((resolve, reject) => process.env.PUBLIC_URL ? resolve(process.env.PUBLIC_URL) : reject(new Error()))
    .catch(error => curl.request({ hostname: '169.254.169.254', path: '/latest/meta-data/public-hostname', headers: { accept: 'text/plain' }}).then(result => 'http://' + result))
    .catch(error => curl.request({ hostname: 'icanhazip.com', path: '/', headers: { accept: 'text/plain' }}).then(result => 'http://' + result))
    .catch(error => 'http://127.0.0.1')
}

module.exports = { getPublicURL }
