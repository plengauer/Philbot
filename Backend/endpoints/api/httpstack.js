
const curl = require('../../shared/curl.js');

async function handle() {
    return {
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: '<html><head><title>Philbot HTTP Cache</title></head><body>'
            + '<h1>Rate Limits</h1><br/>'
            + '<table><tr><th>Bucket</th><th>Requests</th><th>Expiration</th></tr>'
            + curl.ratelimits_summary().map(entry => `<tr><td>${sanitize(entry.bucket)}</td><td>${entry.count}+${entry.active} of ${entry.max}</td><td>` + Math.ceil((entry.timestamp + entry.length * 1000 - Date.now()) / 1000) + 's</td></tr>')
            + '</table>'
            + '<h1>Cache Entries</h1><br/>'
            + '<table><tr><th>Key</th><th>Hits</th><th>Expiration</th><th>Status</th><th>Headers</th><th>Length</th></tr>'
            + curl.cache_summary().map(entry => `<tr><td>${sanitize(entry.key)}</td><td>${entry.hits}</td><td>` + Math.ceil((entry.timestamp + entry.ttl * 1000 - Date.now()) / 1000) + `s</td><td>${entry.value?.status}</td><td>` + Object.keys(entry.value?.headers ?? {}).map(name => `${name}: ${entry.value.headers[name]}`).join('<br/>') + `</td><td>${entry.value?.body.length}</td></tr>`)
            + '</table>'
            + '</body></html>'
    }
}

function sanitize(url) {
    url = strip(url, 'key');
    url = strip(url, 'token');
    return url;
}

function strip(url, key) {
    if (url.includes(key + '=')) {
        let index = url.indexOf('key=');
        url = url.substring(0, index) + url.substring(url.indexOf('&', index))
    }
    return url;
}

module.exports = { handle };