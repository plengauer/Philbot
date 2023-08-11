import './opentelemetry.js';
import process from 'process';
import fs from 'fs';
import { WebSocket } from 'ws';
import http from 'http';
import request from 'request';
import url from 'url';
import opentelemetry from '@opentelemetry/api';

const tracer = opentelemetry.trace.getTracer('discord.gateway');
const meter = opentelemetry.metrics.getMeter('discord.gateway');

const SHARD_INDEX = process.env.SHARD_INDEX ? parseInt(process.env.SHARD_INDEX) : 0;
const SHARD_COUNT = process.env.SHARD_COUNT ? parseInt(process.env.SHARD_COUNT) : 1;
const STATE_FILE = (process.env.STATE_STORAGE_DIRECTORY ?? './') + '.state.' + SHARD_INDEX + '.' + SHARD_COUNT + '.json';

connect(restoreState());

async function connect(prev_state = {}) {
    if (prev_state.server) await new Promise(resolve => prev_state.server.close(resolve));
    let state = {
        session_id: prev_state.session_id,
        sequence: prev_state.sequence,
        resume_gateway_url: prev_state.resume_gateway_url ?? await getGateway(),
    };
    state.callback_port = process.env.PORT ? parseInt(process.env.PORT) : (parseInt(process.env.BASE_PORT ?? "8081") + SHARD_INDEX);
    /*
    const options = {
        key: fs.readFileSync(process.env.HTTP_KEY_FILE ?? "server.key"),
        cert: fs.readFileSync(process.env.HTTP_CERT_FILE ?? "server.cert"),
    };
    state.server = https.createServer(options, (request, response) => handleCallback(state, request, response));
    */
    state.server = http.createServer((request, response) => handleCallback(state, request, response));
    state.server.on('error', error => { console.error(error); });
    state.server.on('close', () => state.socket?.close());
    state.server.listen(state.callback_port);
    state.socket = new WebSocket(state.resume_gateway_url + '?v=10&encoding=json');
    state.socket.on('open', () => console.log('GATEWAY connection established (' + state.resume_gateway_url + ')'));
    state.socket.on('message', message => handleMessage(state, message));
    state.socket.on('error', error => { console.error('GATEWAY connection error: ' + error); state.resume_gateway_url = null; state.session_id = null; });
    state.socket.on('close', code => handleClose(state, code));
    return state;
}

async function getGateway() {
    return new Promise(resolve => request({ url: 'https://discord.com/api/v10/gateway/bot', headers: { authorization: 'Bot ' + process.env.DISCORD_API_TOKEN }, json: true }, (err, res, body) => {
        if (err) return resolve('wss://gateway.discord.gg');
        return resolve(body.url);
    }));
}

const event_counter = meter.createCounter('discord.gateway.events');

function handleMessage(state, message) {
    let event = JSON.parse(message);
    console.log('GATEWAY receive op ' + event.op + ' (' + event.s + ')');
    event_counter.add(1, {
        'discord.gateway.url': state.resume_gateway_url,
        'discord.gateway.shard': SHARD_INDEX, 
        'discord.event.op': event.op,
        'discord.event.name': event.t?.toLowerCase().replace(/_/g, ' ') ?? "",
        'discord.guild.id': event.d?.guild_id ?? (event.t?.startsWith('GUILD_') ? event.d.id : ""),
        'discord.channel.id': event.d?.channel_id ?? (event.t?.startsWith('CHANNEL_') ? event.d.id : ""),
        'discord.user.id': event.d?.user_id ?? event.d?.user?.id ?? event.d?.member?.user?.id ?? event.d?.author?.id ?? (event.t?.startsWith('USER_') ? event.d.id : ""),
        'discord.activities': event.d?.activities?.map(activity => activity.name).join(',')
    });
    switch(event.op) {
        case 0 /* ready | resumed | dispatch */: return handleDispatch(state, event.s, event.t, event.d).catch(error => console.log(error));
        case 1 /* heartbeat request (heartbeat) */: return handleHeartbeatRequest(state).catch(error => console.log(error));
        case 7 /* reconnect */: return handleReconnect(state).catch(error => console.log(error));
        case 9 /* invalid session id */: return handleInvalidSession(state).catch(error => console.log(error));
        case 10 /* hello */: return handleHello(state, event.d).catch(error => console.log(error));
        case 11 /* heartbeat ack */: return handleHeartbeatACK(state).catch(error => console.log(error));
        default: console.error('unknown event opcode: ' + event.op);
    }
}

function handleClose(state, code) {
    console.log('GATEWAY connection closed (' + code + ')');
    switch (code) {
        case 4000 /* unknown error */: return connect(state);
        case 4001 /* unknown opcode */: return connect(state);
        case 4002 /* decode error */: return connect(state);
        case 4003 /* not authenticated */: return connect(state);
        case 4004 /* authentication failed */: return process.exit(0);
        case 4005 /* already authenticated */: return connect(state);
        case 4006: return connect(state);
        case 4007 /* invalid sequence */: return connect(state);
        case 4008 /* rate limited */: return connect(state);
        case 4009 /* session timed out */: return connect(state);
        case 4010 /* invalid shard */: return connect(state);
        case 4011 /* sharding required */: return process.exit(0);
        case 4012 /* invalid API version */: return process.exit(0);
        case 4013 /* invalid intent(s) */: return process.exit(0);
        case 4014 /* disallowed intent(s) */: return process.exit(0);
        default: return connect(state);
    }
}

async function handleHello(state, payload) {
    state.heartbeat_interval = payload.heartbeat_interval;
    console.log('GATEWAY hello (heartbeat interval ' + state.heartbeat_interval + 'ms)');
    sendHeartbeatLater(state);
    return (state.session_id && state.sequence) ? sendResume(state) : sendIdentify(state);
}

async function handleReconnect(state) {
    console.log('GATEWAY reconnect');
    return state.socket.close();
}

async function handleInvalidSession(state) {
    console.log('GATEWAY invalid session');
    return sendIdentify(state);
}

async function sendIdentify(state) {
    console.log('GATEWAY identify');
    return send(state, 2, {
        token: process.env.DISCORD_API_TOKEN,
        properties: {
            os: 'Linux',
            device: 'Philbot',
            browser: 'Philbot'
        },
        'large_threshold': 250,
        'shard': [SHARD_INDEX, SHARD_COUNT],
        'presence': {
            'activities': [{
                'name': 'You',
                'type': 3
            }],
            'status': 'online',
            'since': Date.now(),
            'afk': false
        },
        // https://discord.com/developers/docs/topics/gateway#gateway-intents
        'intents': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 21].map(id => 1 << id).reduce((i1, i2) => i1 | i2, 0)
    });
}

async function sendResume(state) {
    console.log('GATEWAY resume (session_id ' + state.session_id + ', sequence ' + state.sequence + ')');
    return send(state, 6, { 'token': process.env.DISCORD_API_TOKEN, 'session_id': state.session_id, 'seq': state.sequence });
}

async function handleReady(state, payload) {
    state.session_id = payload.session_id;
    state.resume_gateway_url = payload.resume_gateway_url;
    saveState(state);
    console.log('GATEWAY ready (session_id ' + state.session_id + ', resume_gateway_url ' + state.resume_gateway_url + ')');
    return sendPresenceUpdate(state, 'online');
}

async function handleResumed(state) {
    console.log('GATEWAY resumed');
    return sendPresenceUpdate(state, 'online');
}

async function handleHeartbeatRequest(state) {
    console.log('GATEWAY heartbeat request');
    return sendHeartbeat(state);
}

async function handleHeartbeatACK(state) {
    console.log('GATEWAY heartbeat acknowledge');
    return sendHeartbeatLater(state);
}

async function sendHeartbeatLater(state) {
    return setTimeout(() => sendHeartbeat(state), state.heartbeat_interval);
}

async function sendHeartbeat(state) {
    console.log('GATEWAY heartbeat (' + state.sequence + ')');
    return send(state, 1, state.sequence ?? null);
}

async function send(state, op, payload) {
    console.log('GATEWAY send op ' + op);
    return state.socket.send(JSON.stringify({ op: op, d: payload }));
}

async function handleDispatch(state, sequence, event, payload) {
    if (sequence) {
        state.sequence = sequence;
        saveState(state);
    }
    switch(event) {
        case 'READY': return handleReady(state, payload);
        case 'RESUMED': return handleResumed(state);
        default:
            let guild_id = payload.guild_id ?? (event.startsWith('GUILD_') ? payload.id : undefined);
            if (guild_id) payload.callback = { guild_id: guild_id, url: 'http://127.0.0.1:' + state.callback_port }
            const span = tracer.startSpan('Discord ' + event.toLowerCase().replace(/_/g, ' '), { kind: opentelemetry.SpanKind.CONSUMER }, opentelemetry.ROOT_CONTEXT);
            span.setAttribute('discord.gateway.url', state.resume_gateway_url);
            span.setAttribute('discord.gateway.sequence', sequence);
            span.setAttribute('discord.gateway.shard', SHARD_INDEX);
            span.setAttribute('discord.guild.id', payload.guild_id ?? (event.startsWith('GUILD_') ? payload.id : undefined));
            span.setAttribute('discord.channel.id', payload.channel_id ?? (event.startsWith('CHANNEL_') ? payload.id : undefined));
            span.setAttribute('discord.role.id', payload.role_id ?? (event.startsWith('ROLE_') ? payload.id : undefined));
            span.setAttribute('discord.user.id', payload.user_id ?? payload.user?.id ?? payload.member?.user?.id ?? payload.author?.id ?? (event.startsWith('USER_') ? payload.id : undefined));
            span.setAttribute('discord.message.id', payload.message_id ?? (event.startsWith('MESSAGE_') ? payload.id : undefined));
            span.setAttribute('discord.status', payload.status);
            span.setAttribute('discord.client_status.desktop', payload.client_status?.desktop);
            span.setAttribute('discord.client_status.mobile', payload.client_status?.mobile);
            span.setAttribute('discord.client_status.web', payload.client_status?.web);
            span.setAttribute('discord.activities', payload.activities?.map(activity => activity.name + (activity.details ? ', ' + activity.details : '') + (activity.state ? ', ' + activity.state : '')))
            return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span),
                    () => dispatch(state, event, payload)
                )
                .finally(() => span.end())
    }
}

async function dispatch(state, event, payload) {
    if (deduplicate(event, payload)) {
        console.log('GATEWAY deduplicate ' + event.toLowerCase());
        return;
    }
    console.log('GATEWAY dispatch ' + event.toLowerCase());
    try {
        await HTTP(event, payload);
        if (state.backend_unavailable) {
            state.backend_unavailable = false;
            await sendPresenceUpdate(state, 'online');
        }
    } catch (error) {
        if (!state.backend_unavailable) {
            state.backend_unavailable = true;
            await sendPresenceUpdate(state, 'invisible');
        }
        throw error;
    }
}

async function sendPresenceUpdate(state, status) {
    console.log('GATEWAY presence update (status ' + status + ')');
    return send(state, 3, { status: status, activities: [], afk: false, since: null });
}

async function HTTP(event, payload, delay = undefined) {
    if (delay && delay > 1000 * 60 * 15) throw new Error('HTTP RETRIES EXCEEDED')
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    let body = JSON.stringify(payload);
    let url = 'http://' + (process.env.FORWARD_HOST ?? '127.0.0.1') + ':' + (process.env.FORWARD_PORT ?? '8080') + (process.env.FORWARD_PATH ?? '/discord') + '/' + event.toLowerCase();
    let time = Date.now();
    return new Promise((resolve, reject) => request.post({ url: url, headers: { 'content-encoding': 'identity', 'content-type': 'application/json', 'x-authorization': process.env.DISCORD_API_TOKEN }, body: body }, (error, response, body) => {
        if (error) {
            console.log('HTTP POST ' + url + ' => ' + error);
            return reject(error);
        }
        console.log('HTTP POST ' + url + ' => ' + response.statusCode + ' (' + (Date.now() - time) + 'ms)');
        if (response.statusCode == 503 || response.statusCode == 429) return reject(response.statusCode);
        return resolve();
    })).catch(() => HTTP(event, payload, delay ? delay * 2 : 1000));
}

async function handleCallback(state, request, response) {
    console.log('HTTP CALLBACK SERVER serving ' + url.parse(request.url).pathname);
    return new Promise(resolve => {
        let buffer = '';
        request.on('data', data => { buffer += data; });
        request.on('end', () => {
            if (!request.headers['x-authorization']) {
                response.writeHead(401, 'Unauthorized', { 'content-type': 'text/plain' });
                response.end();
                resolve();
                return;
            }
            if (request.headers['x-authorization'] != process.env.DISCORD_API_TOKEN) {
                response.writeHead(403, 'Forbidden', { 'content-type': 'text/plain' });
                response.end();
                resolve();
                return;
            }
            if (request.method != 'POST') {
                response.writeHead(405, 'Method not allowed', { 'content-type': 'text/plain' });
                response.end();
                resolve();
                return;
            }
            let payload = null;
            if (request.method == 'POST' && buffer.length > 0) {
                try {
                    payload = JSON.parse(buffer);
                } catch {
                    response.writeHead(400, 'Bad Request', { 'content-type': 'text/plain' });
                    response.end();
                    resolve();
                    return;
                }
            }
            try {
                if (payload.guild_id && (BigInt(payload.guild_id) >> BigInt(22)) % BigInt(SHARD_COUNT) != BigInt(SHARD_INDEX)) {
                    response.writeHead(422, 'Wrong shard', { 'content-type': 'text/plain' });
                    response.end();
                } else {
                    switch (url.parse(request.url).pathname) {
                        case '/voice_state_update':
                            console.log('GATEWAY voice state update ' + (payload.channel_id ?? 'null'));
                            if (payload.channel_id) {
                                send(state, 4, { guild_id: payload.guild_id, channel_id: payload.channel_id, self_mute: false, self_deaf: false });
                            } else {
                                send(state, 4, { guild_id: payload.guild_id, channel_id: null });
                            }
                            response.writeHead(200, 'Success', { 'content-type': 'text/plain' });
                            response.end();    
                            break;
                        default:
                            response.writeHead(404, 'Not Found', { 'content-type': 'text/plain' });
                            response.end();
                            break;
                    }
                }
            } catch(exception) {
                console.error(exception);
                response.writeHead(500, 'Internal server error', { 'content-type': 'text/plain' });
                response.end();
            }
            resolve();
        })
    }).finally(() => console.log('HTTP CALLBACK SERVER served ' + url.parse(request.url).pathname));
}

function saveState(state) {
    return fs.writeFileSync(STATE_FILE, JSON.stringify({ session_id: state.session_id, resume_gateway_url: state.resume_gateway_url, sequence: state.sequence }));
}

function restoreState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE));
    } catch {
        return {};
    }
}

function deduplicate(event, payload) {
    if (event == 'PRESENCE_UPDATE') {
        let last = null; // TODO
        if (!last ||
            payload.guild_id != last.guild_id || payload.status != last.status ||
            !Object.keys(payload.user).every(key => payload.user[key] == last.user[key]) ||
            !Object.keys(payload.client_status).every(key => payload.client_status[key] == last.client_status[key]) ||
            payload.activities.length != last.activities.length
        ) return false;
        for (let i = 0; i < payload.activities.length; i++) {
            if (!Object.keys(payload.activities[i]).every(key => payload.activities[i][key] == last.activities[i][key])) return false;
        }
        return true;
    }
    return false;
}
