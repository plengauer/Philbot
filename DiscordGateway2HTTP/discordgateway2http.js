require('philbot-opentelemetry');
const process = require('process');
const fs = require('fs');
const { WebSocket } = require('ws');
const request = require('request');
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('discord.gateway');

connect(restoreState());

async function connect(prev_state = {}) {
    state = {
        session_id: prev_state.session_id,
        sequence: prev_state.sequence,
        resume_gateway_url: prev_state.resume_gateway_url ?? await getGateway(),
    };
    state.socket = new WebSocket(state.resume_gateway_url + '?v=10&encoding=json');
    state.socket.on('open', () => console.log('GATEWAY connection established (' + state.resume_gateway_url + ')'));
    state.socket.on('message', message => handleMessage(state, message));
    state.socket.on('error', error => console.error('GATEWAY connection error: ' + error));
    state.socket.on('close', code => handleClose(state, code));
    return state;
}

async function getGateway() {
    return new Promise(resolve => request({ url: 'https://discord.com/api/v10/gateway/bot', headers: { authorization: 'Bot ' + process.env.DISCORD_API_TOKEN }, json: true }, (err, res, body) => {
        if (err) return resolve('wss:gateway.discord.gg');
        return resolve(body.url);
    }));
}

function handleMessage(state, message) {
    let event = JSON.parse(message);
    console.log('GATEWAY receive op ' + event.op + ' (' + event.s + ')');
    switch(event.op) {
        case 0 /* ready | dispatch */: return handleDispatch(state, event.s, event.t, event.d);
        case 1 /* heartbeat request (heartbeat) */: return handleHeartbeatRequest(state);
        case 7 /* reconnect */: return handleReconnect(state);
        case 9 /* invalid session id */: return handleInvalidSession(state)
        case 10 /* hello */: return handleHello(state, event.d);
        case 11 /* heartbeat ack */: return handleHeartbeatACK(state);
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
        'shard': [0, 1],
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
}

async function handleResumed() {
    console.log('GATEWAY resumed');
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
    return setTimeout(() => sendHeartbeat(state), state.heartbeat_interval * Math.random());
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
        case 'RESUMED': return handleResumed();
        default:
            const span = tracer.startSpan('discord.' + event, { kind: opentelemetry.SpanKind.CONSUMER }, undefined);
            return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span),
                    () => dispatch(event, payload)
                )
                .finally(() => span.end())
    }
}

async function dispatch(event, payload) {
    if (deduplicate(event, payload)) {
        console.log('GATEWAY deduplicate ' + event.toLowerCase());
        return;
    }
    console.log('GATEWAY dispatch ' + event.toLowerCase());
    return http(event, payload);
}

async function http(event, payload, delay = undefined) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    let body = JSON.stringify(payload);
    let url = 'http://' + (process.env.FORWARD_HOST ?? '127.0.0.1') + (process.env.FORWARD_PATH ?? '/discord') + '/' + event.toLowerCase();
    let time = Date.now();
    return new Promise((resolve, reject) => request.post({ url: url, headers: { 'content-encoding': 'identity', 'content-type': 'application/json' }, body: body })
        .on('response', response => {
    	    console.log('HTTP POST ' + url + ' => ' + response.statusCode + ' (' + (Date.now() - time) + 'ms)');
    	    return response.statusCode == 503 || response.statusCode == 429 ? reject(response.statusCode) : resolve(response.body);
        })
        .on('error', error => {
    	    console.log('HTTP POST ' + url + ' => ' + error);
            return reject(error);
        })
    ).catch(() => http(event, payload, delay ? delay * 2 : 1000));
}

function saveState(state) {
    return fs.writeFileSync('.state.json', JSON.stringify({ session_id: state.session_id, resume_gateway_url: state.resume_gateway_url, sequence: state.sequence }));
}

function restoreState() {
    try {
        return JSON.parse(fs.readFileSync('.state.json'));
    } catch {
        return {};
    }
}

function deduplicate(event, payload) {
    return false;
}
