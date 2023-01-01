const process = require('process');
const curl = require('./curl.js');

async function getPublicURL() {
  return new Promise((resolve, reject) => process.env.PUBLIC_URL ? resolve(process.env.PUBLIC_URL) : reject(new Error()))
    .then(url => curl.request({ secure: false, method: 'GET', hostname: url.substring(url.indexOf('://') + 3), path: '/' }).then(result => new Promise((resolve, reject) => result.includes('<title>Philbot</title>') ? resolve(url) : reject(new Error()))))
    .catch(error => curl.request({ secure: false, method: 'GET', hostname: '169.254.169.254', path: '/latest/meta-data/public-hostname', headers: { accept: 'text/plain' }, cache: 60 * 60 * 24 }).then(result => 'http://' + result.trim()))
    .catch(error => curl.request({ secure: false, method: 'GET', hostname: 'icanhazip.com', path: '/', headers: { accept: 'text/plain' }, cache: 60 * 60 * 24 }).then(result => 'http://' + result.trim()))
    .catch(error => 'http://127.0.0.1')
}

module.exports = { getPublicURL }
