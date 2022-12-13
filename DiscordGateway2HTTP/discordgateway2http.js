
const { WebSocket } = require('ws');
const request = require('request');

//TODO handle reconnects on error
//TODO handle reconnects on close

async function connect(prev_state = {}) {
    state = {
        session_id: prev_state.session_id,
        sequence: prev_state.sequence,
        resume_gateway_url: prev_state.resume_gateway_url ?? await getGateway(),
        in_progress: prev_state.in_progress
    };
    state.socket = new WebSocket(state.resume_gateway_url + '?v=10&encoding=json');
    state.socket.on('open', () => console.log('connection established (' + state.resume_gateway_url + ')'));
    state.socket.on('message', message => handleMessage(state, message));
    state.socket.on('error', error => console.error('connection error: ' + error));
    state.socket.on('close', code => handleClose(state, code));
    return state;
}

async function getGateway() {
    return new Promise(resolve => request({ url: 'https://discord.com/api/v10/gateway/bot', headers: { Authorization: 'Bot ' + process.env.DISCORD_TOKEN }, json: true }, (err, res, body) => {
        if (err) return resolve('wss:gateway.discord.gg');
        return resolve(body.url);
    }))
}

function handleMessage(state, message) {
    let event = JSON.parse(message);
    console.log('receive ' + event.op + ' (' + event.s + ')');
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
    console.log('connection closed (' + code + ')');
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
        case 4011 /* shareding required */: return process.exit(0);
        case 4012 /* invalid API version */: return process.exit(0);
        case 4013 /* invalid intent(s) */: return process.exit(0);
        case 4014 /* disallowed intent(s) */: return process.exit(0);
        default: return connect(state);
    }
}

async function handleHello(state, payload) {
    state.heartbeat_interval = payload.heartbeat_interval;
    console.log('hello (heartbeat interval ' + state.heartbeat_interval + 'ms)');
    sendHeartbeatLater(state);
    return state.sequence ? sendResume(state) : sendIdentify(state);
}

async function handleReconnect(state) {
    console.log('reconnect');
    return state.socket.close();
}

async function handleInvalidSession(state) {
    console.log('invalid session');
    return sendIdentify(state);
}

async function sendIdentify(state) {
    console.log('identify');
    return send(2, {
        token: process.env.DISCORD_TOKEN,
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
    console.log('resume (session_id ' + state.session_id + ', sequence ' + state.sequence + ')');
    return send(6, { 'token': process.env.DISCORD_TOKEN, 'session_id': state.session_id, 'seq': state.sequence });
}

async function handleReady(state, payload) {
    state.session_id = payload.session_id;
    state.resume_gateway_url = payload.resume_gateway_url;
    console.log('ready (session_id ' + state.session_id + ', resume_gateway_url ' + state.resume_gateway_url + ')');
}

async function handleResumed() {
    console.log('resumed');
}

async function handleHeartbeatRequest(state) {
    console.log('heartbeat request');
    return sendHeartbeat(state);
}

async function handleHeartbeatACK(state) {
    console.log('heartbeat acknowledge');
    return sendHeartbeatLater(state);
}

async function sendHeartbeatLater(state) {
    return setTimeout(() => sendHeartbeat(state), state.heartbeat_interval * Math.random());
}

async function sendHeartbeat(state) {
    console.log('heartbeat (' + state.sequence + ')');
    return send(1, state.sequence ?? null);
}

async function send(op, payload) {
    console.log('send ' + op);
    return state.socket.send(JSON.stringify({ op: op, d: payload }));
}

async function handleDispatch(state, sequence, event, payload) {
    if (Math.random() < 0.1) return handleReconnect(state);
    switch(event) {
        case 'READY': return handleReady(state, payload);
        case 'RESUMED': return handleResumed();
        default:
            state.sequence = sequence;
            state.in_progress = (state.in_progress ?? []).concat([sequence]);
            //TODO save event to replay if necessary
            return dispatch(event, payload)
                .then(result => {
                    state.in_progress = state.in_progress.filter(s => s != sequence);
                    return result;
                });
    }
}

async function dispatch(event, payload) {
    console.log('dispatch ' + event.toLowerCase());
    //console.log('HTTP POST https://localhost:1234/discord/' + event.toLowerCase());
    return new Promise(resolve => setTimeout(resolve, 1000 * 60 * 5 * Math.random()));
}

connect();