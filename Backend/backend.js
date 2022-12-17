const process = require('process');
const https = require('https');
const url = require("url");
const fs = require("fs");

const endpoint_about = require('./endpoints/api/about.js');
const endpoint_autorefresh = require('./endpoints/api/autorefresh.js');
const endpoint_configure = require('./endpoints/api/configure.js');
const endpoint_debug = require('./endpoints/api/debug.js');
const endpoint_deploy = require('./endpoints/api/deploy.js');
const endpoint_help = require('./endpoints/api/help.js');
const endpoint_monitoring = require('./endpoints/api/monitoring.js');
const endpoint_sourcecode = require('./endpoints/api/sourcecode.js');
const endpoint_scheduler_monthly = require('./endpoints/api/scheduler/monthly.js');
const endpoint_scheduler_daily = require('./endpoints/api/scheduler/daily.js');
const endpoint_discord_guild_create = require('./endpoints/api/discord/guild_create.js');
const endpoint_discord_guild_member_add = require('./endpoints/api/discord/guild_member_add.js');
const endpoint_discord_message_create = require('./endpoints/api/discord/message_create.js');
const endpoint_discord_presence_update = require('./endpoints/api/discord/presence_update.js');
const endpoint_discord_voice_state_update = require('./endpoints/api/discord/voice_state_update.js');

let revision = 0;
let revision_done = -1;
let revisions_done = [];
let operations = [];

let server = https.createServer((request, response) => handle(request, response));
server.on('error', error => console.error(error));
server.on('close', () => shutdown())
server.listen(process.env.PORT ?? 443);
setInterval(checkTimeout, 1000 * 60);

function handle(request, response) {
    if (request.method != 'POST') {
        response.writeHead(400, { 'content-type': 'text/plain' });
        response.end('Bad Request');
    }
    if (request.headers['content-encoding'] != 'identity') {
        response.writeHead(400, { 'content-type': 'text/plain' });
        response.end('Bad Request');
    }
    if (request.headers['content-type'] != 'application/json') {
        response.writeHead(400, { 'content-type': 'text/plain' });
        response.end('Bad Request');
    }
    //TODO authentication!!!! with same token
    let path = url.parse(request.url).pathname;
    let buffer = '';
    request.on('data', data => { buffer += data; });
    request.on('end', () => dispatchAnyWithTimeout(path, JSON.parse(buffer), response));
}

async function dispatchAnyWithTimeout(path, payload, response) {
    let operation = { revision: revision++, timestamp: Date.now() };
    operations.push(operation);
    return dispatchAny(path, payload, response)
        .finally(() => operations = operations.filter(op => op.revision != operation.revision))
        .finally(() => revisions_done.push(operation.revision))
        .finally(() => {
            while (revisions_done.includes(revision_done + 1)) {
                revisions_done = revisions_done.filter(r => r != revision_done + 1);
                revision_done++;
            }
        });
}

async function dispatchAny(path, payload, response) {
    if (fs.existsSync('./endpoints/www/' + path)) {
        path = './endpoints/www/' + path;
        let contentType;
        if (path.endsWith('.txt')) contentType = 'text/plain';
        else if (path.endsWith('.html')) contentType = 'text/html';
        else if (path.endsWith('.xml')) contentType = 'text/xml';
        else if (path.endsWith('.ico')) contentType = 'image/vnd.microsoft.icon';
        else contentType = 'text/plain';
        response.writeHead(200, { 'content-type': contentType, 'content-encoding': 'identity', 'content-length': fs.statSync(path).size });
        fs.createReadStream(path).pipe(response);
        response.end();
        return;
    } else {
        return dispatchAPI(path, payload)
            .catch(error => {
                console.error(error.stack);
                return { status: 500, body: 'An internal error has occurred!' };
            })
            .then(result => {
                if (!result) {
                    result = { status: 200, body: 'Success' };
                }
                if (result.body) {
                    if (typeof result.body == 'object') {
                        result.body = JSON.stringify(result.body);
                        result.headers['content-type'] = 'application/json';
                    } else if (result.body == 'string' && !result.headers['content-type']) {
                        result.headers['content-type'] = 'text/plain';
                    }
                    result.headers['content-encoding'] = 'identity';
                    result.headers['content-length'] = result.body.length;    
                }
                response.writeHead(result.status, result.headers);
                if (result.body) response.write(response.body);
                response.end();
            });
    }
}

async function dispatchAPI(path, payload) {
    switch (path) {
        case '/about': return endpoint_about.handle();
        case '/autorefresh': return endpoint_autorefresh.handle();
        case '/configure': return endpoint_configure.handle();
        case '/debug': return endpoint_debug.handle();
        case '/deploy': return endpoint_deploy.handle();
        case '/help': return endpoint_help.handle();
        case '/monitoring': return endpoint_monitoring.handle();
        case '/sourcecode': return endpoint_sourcecode.handle();
        case '/scheduler/monthly': return endpoint_scheduler_monthly.handle();
        case '/scheduler/daily': return endpoint_scheduler_daily.handle();
        case '/discord/guild_create': return endpoint_discord_guild_create.handle(payload);
        case '/discord/guild_member_add': return endpoint_discord_guild_member_add.handle(payload);
        case '/discord/message_create': return endpoint_discord_message_create.handle(payload);
        case '/discord/presence_update': return endpoint_discord_presence_update.handle(payload);
        case '/discord/voice_state_update': return endpoint_discord_voice_state_update.handle(payload);
        default: return { status: 404, body: 'Not found' };
    }
}

async function shutdown() {
    while (operations.length > 0) await new Promise(resolve => setTimeout(resolve, 1000));
    process.exit(0);
}

async function checkTimeout() {
    const timeout = process.env.TIMEOUT ?? 1000 * 60 * 60;
    let timedouts = operations.filter(operation => operation.timestamp < Date.now() - timeout);
    if (timedouts.length == 0) return;
    // if we have timed out operations, lets close the server to not accept new operations, and then remove all timed out operations as if they would not exist
    server.close();
    operations = operations.filter(operation => !timedouts.some(timedout => timedout.revision == operation.revision));
}