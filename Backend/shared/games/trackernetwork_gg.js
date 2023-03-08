const process = require('process');
const curl = require('../curl.js');

async function get(host, path) {
  return curl.request({ hostname: host, path: path, headers: { 'TRN-Api-Key': process.env.TRACKER_GG_API_TOKEN } });
}

module.exports = { get }

















