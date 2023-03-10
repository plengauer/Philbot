const process = require('process');
const curl = require('./curl.js');

async function getPublicURL() {
  return new Promise((resolve, reject) => process.env.PUBLIC_URL ? resolve(process.env.PUBLIC_URL) : reject(new Error()))
    .catch(error =>
      curl.request_simple({ secure: false, method: 'GET', hostname: '169.254.169.254', path: '/latest/meta-data/public-hostname', headers: { accept: 'text/plain' }, timeout: 100, fail_on_timeout: false, cache: 60 })
        .then(response => response.status == 200 ? Promise.resolve(response.body) : Promise.reject(new Error('Not AWS')))
        .then(result => 'http://' + result.trim())
    )
    .catch(error => curl.request({ secure: false, method: 'GET', hostname: 'icanhazip.com', path: '/', headers: { accept: 'text/plain' }, cache: 60 }).then(result => 'http://' + result.trim()))
    .catch(error => 'http://127.0.0.1');
}

module.exports = { getPublicURL }
