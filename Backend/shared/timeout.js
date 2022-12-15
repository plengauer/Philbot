const fs = require('fs');

function getRequestTimeout() {
  let timeout = process.env.REQUEST_TIMEOUT;
  if (!timeout) timeout = JSON.parse(fs.readFileSync('./stdlib.json')).timeout;
  return timeout;
}

function register(func, threshold = 0.9) {
  let timeout = getRequestTimeout();
  if (timeout) {
    timeout = Number(timeout) - process.uptime();
    timeout = Math.max(timeout * threshold, timeout - 5 * 1000);
    setTimeout(func, Math.floor(timeout));
  }
}

module.exports = { register, getRequestTimeout }
