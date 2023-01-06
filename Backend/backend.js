require('philbot-opentelemetry');
const process = require('process');
const http = require('http');
const url = require("url");
const fs = require("fs");
const opentelemetry = require('@opentelemetry/api');

const endpoint_about = require('./endpoints/api/about.js');
const endpoint_autorefresh = require('./endpoints/api/autorefresh.js');
const endpoint_configure = require('./endpoints/api/configure.js');
const endpoint_debug = require('./endpoints/api/debug.js');
const endpoint_deploy = require('./endpoints/api/deploy.js');
const endpoint_help = require('./endpoints/api/help.js');
const endpoint_monitoring = require('./endpoints/api/monitoring.js');
const endpoint_code = require('./endpoints/api/code.js');
const endpoint_ssh = require('./endpoints/api/ssh.js');
const endpoint_server = require('./endpoints/api/server.js');
const endpoint_memoryexport = require('./endpoints/api/memoryexport.js');
const endpoint_http = require('./endpoints/api/httpstack.js');
const endpoint_scheduler_monthly = require('./endpoints/api/scheduler/monthly.js');
const endpoint_scheduler_daily = require('./endpoints/api/scheduler/daily.js');
const endpoint_scheduler_hourly = require('./endpoints/api/scheduler/hourly.js');
const endpoint_discord_guild_create = require('./endpoints/api/discord/guild_create.js');
const endpoint_discord_guild_member_add = require('./endpoints/api/discord/guild_member_add.js');
const endpoint_discord_guild_scheduled_event_create = require('./endpoints/api/discord/guild_scheduled_event_create.js');
const endpoint_discord_message_create = require('./endpoints/api/discord/message_create.js');
const endpoint_discord_message_reaction_add = require('./endpoints/api/discord/message_reaction_add.js');
const endpoint_discord_message_reaction_remove = require('./endpoints/api/discord/message_reaction_remove.js');
const endpoint_discord_presence_update = require('./endpoints/api/discord/presence_update.js');
const endpoint_discord_voice_state_update = require('./endpoints/api/discord/voice_state_update.js');
const endpoint_discord_voice_server_update = require('./endpoints/api/discord/voice_server_update.js');

let revision = 0;
let revision_done = -1;
let revisions_done = [];
let operations = [];

let server = http.createServer((request, response) => handleSafely(request, response));
server.on('error', error => { console.error(error); shutdown(); });
server.on('close', () => shutdown())
server.listen(process.env.PORT ?? 80);
setInterval(checkTimeout, 1000 * 60);
console.log('HTTP SERVER ready');

function handleSafely(request, response) {
    try {
        handle(request, response);
    } catch (error) {
        console.error(`HTTP SERVER handling ${request.url} failed ` + error);
    }
}

function handle(request, response) {
    if (request.method != 'POST' && request.method != 'GET') {
        response.writeHead(405, 'Method Not Allowed', { 'content-type': 'text/plain' });
        response.end();
        return;
    }
    if (request.headers['content-encoding'] && request.headers['content-encoding'] != 'identity') {
        response.writeHead(400, 'Bad Request', { 'content-type': 'text/plain' });
        response.end();
        return;
    }
    if (request.method == 'POST' && request.headers['content-type'] != 'application/json') {
        response.writeHead(400, 'Bad Request', { 'content-type': 'text/plain' });
        response.end();
        return;
    }
    let buffer = '';
    request.on('data', data => { buffer += data; });
    request.on('end', () => {
        let payload = null;
        if (request.method == 'POST' && buffer.length > 0) {
            try {
                payload = JSON.parse(buffer);
            } catch {
                response.writeHead(400, 'Bad Request', { 'content-type': 'text/plain' });
                response.end();
                return;
            }
        }
    	dispatchAnyWithTimeout(url.parse(request.url).pathname, url.parse(request.url, true).query, request.headers, payload, response).catch(error => console.error(`HTTP SERVER dispatching ${request.url} failed: ` + error.stack));
    });
}

async function dispatchAnyWithTimeout(path, params, headers, payload, response) {
    let operation = { revision: revision++, timestamp: Date.now() };
    operations.push(operation);
    console.log(`HTTP SERVER request #${operation.revision}: serving ${path}`);
    return dispatchAny(path, params, headers, payload, response)
        .finally(() => {
            let duration = Date.now() - operation.timestamp;
            console.log(`HTTP SERVER request #${operation.revision}: served ${path} (${duration}ms)`);
        })
        .finally(() => operations = operations.filter(op => op.revision != operation.revision))
        .finally(() => revisions_done.push(operation.revision))
        .finally(() => {
            while (revisions_done.includes(revision_done + 1)) {
                revisions_done = revisions_done.filter(r => r != revision_done + 1);
                revision_done++;
            }
        });
}

async function dispatchAny(path, params, headers, payload, response) {
    if (path.includes('..')) {
        response.writeHead(403, 'Forbidden');
        response.end();
        return;
    } else if (path == '/') {
        response.writeHead(301, 'Moved Permanently', { location: '/index.html' });
        response.end();
        return;
    } else if (path.endsWith('/')) {
        response.writeHead(301, 'Moved Permanently', { location: path.substring(0, path.length - 1) });
        response.end();
        return;
    } else if (fs.existsSync('./endpoints/www/' + path)) {
        path = './endpoints/www/' + path;
        let contentType;
        if (path.endsWith('.txt')) contentType = 'text/plain';
        else if (path.endsWith('.html')) contentType = 'text/html';
        else if (path.endsWith('.xml')) contentType = 'text/xml';
        else if (path.endsWith('.json')) contentType = 'application/json';
        else if (path.endsWith('.ico')) contentType = 'image/vnd.microsoft.icon';
        else contentType = 'text/plain';
        return new Promise(resolve => {
            response.writeHead(200, { 'content-type': contentType, 'content-encoding': 'identity' });
            let stream = fs.createReadStream(path);
            stream.on('end', () => resolve(response.end()));
            stream.pipe(response);
        });
    } else {
        return dispatchAPI(path, params, headers, payload)
            .catch(error => {
                console.error(error.stack);
                opentelemetry.trace.getSpan(opentelemetry.context.active())?.recordException(error);
                return { status: 500, body: 'An internal error has occurred!' };
            })
            .then(result => {
                if (!result) {
                    result = { status: 200, body: 'Success' };
                }
                if (result.body) {
                    result.headers = result.headers ?? {};
                    if (result.headers['content-type'] == 'application/zip') { // this should really be "if body is buffer"
                        // body will be buffer
                    } else if (typeof result.body == 'object') {
                        result.body = JSON.stringify(result.body);
                        result.headers['content-type'] = 'application/json';
                    } else if (typeof result.body != 'string') {
                        result.body = '' + result.body;
                    }
                    result.headers['content-type'] = result.headers['content-type'] ?? 'text/plain';
                    result.headers['content-encoding'] = 'identity';  
                }
                if (500 <= result.status && result.status < 600) {
                    opentelemetry.trace.getSpan(opentelemetry.context.active())?.setStatus({ code: opentelemetry.SpanStatusCode.ERROR });
                }
                response.writeHead(result.status, result.headers);
                if (result.body) response.write(result.body);
                response.end();
            });
    }
}

async function dispatchAPI(path, params, headers, payload) {
    switch (path) {
        case '/about': return endpoint_about.handle();
        case '/autorefresh': return endpoint_autorefresh.handle(params, headers);
        case '/configure': return endpoint_configure.handle();
        case '/debug': return endpoint_debug.handle();
        case '/deploy': return endpoint_deploy.handle();
        case '/help': return endpoint_help.handle();
        case '/monitoring': return endpoint_monitoring.handle();
        case '/code': return endpoint_code.handle();
        case '/ssh': return endpoint_ssh.handle();
        case '/server': return endpoint_server.handle();
        case '/http': return endpoint_http.handle();
        case '/memoryexport': return endpoint_memoryexport.handle();
        case '/scheduler/monthly': return endpoint_scheduler_monthly.handle();
        case '/scheduler/daily': return endpoint_scheduler_daily.handle();
        case '/scheduler/hourly': return endpoint_scheduler_hourly.handle();
        case '/discord/guild_create': return endpoint_discord_guild_create.handle(payload);
        case '/discord/guild_member_add': return endpoint_discord_guild_member_add.handle(payload);
        case '/discord/guild_scheduled_event_create': return endpoint_discord_guild_scheduled_event_create.handle(payload);
        case '/discord/message_create': return endpoint_discord_message_create.handle(payload);
        case '/discord/message_reaction_add': return endpoint_discord_message_reaction_add.handle(payload);
        case '/discord/message_reaction_remove': return endpoint_discord_message_reaction_remove.handle(payload);
        case '/discord/presence_update': return endpoint_discord_presence_update.handle(payload);
        case '/discord/voice_state_update': return endpoint_discord_voice_state_update.handle(payload);
        case '/discord/voice_server_update': return endpoint_discord_voice_server_update.handle(payload);
        default: return { status: 404, body: 'Not found' };
    }
}

async function shutdown() {
    console.log('HTTP SERVER shutting down');
    process.exit(0);
}

async function checkTimeout() {
    const timeout = parseInt(process.env.TIMEOUT) ?? 1000 * 60 * 60;
    let timedouts = operations.filter(operation => operation.timestamp < Date.now() - timeout);
    if (timedouts.length == 0) return;
    // if we have timed out operations, lets close the server to not accept new operations, and then remove all timed out operations as if they would not exist
    timedouts.forEach(timedout => console.log(`HTTP SERVER request hanging #${timedout.revision}`));
    console.log('HTTP SERVER closing for new connections');
    server.close();
    console.log(`HTTP SERVER waiting for ${operations.length} in-progress operations to complete`);
    for (let i = 0; i < 10 && operations.length > 0; i++) await new Promise(resolve => setTimeout(resolve, 1000));
    console.log(`HTTP SERVER closing all connections (${operations.length} in progress)`);
    server.closeAllConnections();
}

