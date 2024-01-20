const process = require('process');
const fs = require("fs");
const crypto = require('crypto');
const propertiesReader = require('properties-reader');
const opentelemetry_api = require('@opentelemetry/api');
const opentelemetry_sdk = require('@opentelemetry/sdk-node');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { PeriodicExportingMetricReader, AggregationTemporality} = require('@opentelemetry/sdk-metrics');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-proto');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { AlwaysOnSampler, AlwaysOffSampler } = require('@opentelemetry/core');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { envDetector, processDetector } = require('@opentelemetry/resources');
const { gitSyncDetector } = require('opentelemetry-resource-detector-git');
const { gitHubDetector } = require('@opentelemetry/resource-detector-github');
const { containerDetector } = require('@opentelemetry/resource-detector-container');
const { awsBeanstalkDetector, awsEc2Detector, awsEcsDetector, awsEksDetector } = require('@opentelemetry/resource-detector-aws');
const { gcpDetector } = require('@opentelemetry/resource-detector-gcp');
const { alibabaCloudEcsDetector } = require('@opentelemetry/resource-detector-alibaba-cloud');

class ShutdownAwareSpanProcessor {
  processor;
  open;
  
  constructor(processor) {
    this.processor = processor;
    this.open = [];
  }
  
  onStart(span) {
    this.open.push(span);
    return this.processor.onStart(span);
  }
  
  onEnd(span) {
    let new_open = this.open.filter(s => s != span);
    let doEnd = new_open.length < this.open.length;
    this.open = new_open;
    return doEnd ? this.processor.onEnd(span) : undefined;
  }
  
  shutdown() {
    for (let span of this.open) {
      span.setStatus({ code: opentelemetry_api.SpanStatusCode.ERROR });
      span.recordException('Aborted (shutdown)');
      span.end();
    }
    this.open = [];
    return this.processor.shutdown();
  }
}

class DynatraceResourceDetector {
  detect() {
    for (let name of ['dt_metadata_e617c525669e072eebe3d0f08212e8f2.properties', '/var/lib/dynatrace/enrichment/dt_metadata.properties']) {
      try {
        return new Resource(propertiesReader(name.startsWith("/var") ? name : fs.readFileSync(name).toString()).getAllProperties());
      } catch { }
    }
    return new Resource({});
  }
}

class ServiceResourceDetector {
  detect() {
    return new Resource({
      [SemanticResourceAttributes.SERVICE_NAMESPACE]: 'Philbot',
      [SemanticResourceAttributes.SERVICE_NAME]: 'Philbot Backend',
      [SemanticResourceAttributes.SERVICE_VERSION]: JSON.parse('' + fs.readFileSync('package.json')).version,
      [SemanticResourceAttributes.SERVICE_INSTANCE_ID]: crypto.randomUUID(),
    });
  }
}

async function opentelemetry_init() {
  let sdk = opentelemetry_create();
  process.on('exit', () => sdk.shutdown());
  process.on('SIGINT', () => sdk.shutdown());
  process.on('SIGQUIT', () => sdk.shutdown());
  return sdk.start();
}

function opentelemetry_create() {
  return new opentelemetry_sdk.NodeSDK({
    sampler: process.env.OPENTELEMETRY_TRACES_API_ENDPOINT ? new AlwaysOnSampler() : new AlwaysOffSampler(),
    spanProcessor: new ShutdownAwareSpanProcessor(
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: process.env.OPENTELEMETRY_TRACES_API_ENDPOINT,
          headers: { Authorization: process.env.OPENTELEMETRY_TRACES_API_TOKEN },
        }),
      )
    ),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: process.env.OPENTELEMETRY_METRICS_API_ENDPOINT,
        headers: { Authorization: process.env.OPENTELEMETRY_METRICS_API_TOKEN },
        temporalityPreference: AggregationTemporality.DELTA
      }),
      exportIntervalMillis: 5000,
    }),
    instrumentations: [getNodeAutoInstrumentations({'@opentelemetry/instrumentation-fs': { enabled: false }})],
    resourceDetectors: [
      new DynatraceResourceDetector(),
      alibabaCloudEcsDetector,
      gcpDetector,
      // TODO azure
      awsBeanstalkDetector, awsEc2Detector, awsEcsDetector, awsEksDetector,
      containerDetector, // TODO k8s detector
      gitSyncDetector, gitHubDetector,
      processDetector,
      envDetector,
      new ServiceResourceDetector()
    ]
  });
}

opentelemetry_init();

const http = require('http');
const https = require('https');
const url = require("url");

const favicon = require('./endpoints/api/favicon.ico.js');
const endpoint_about = require('./endpoints/api/about.js');
const endpoint_privacy = require('./endpoints/api/privacy.js');
const endpoint_autorefresh = require('./endpoints/api/autorefresh.js');
const endpoint_configure = require('./endpoints/api/configure.js');
const endpoint_debug = require('./endpoints/api/debug.js');
const endpoint_invite = require('./endpoints/api/invite.js');
const endpoint_deploy = require('./endpoints/api/deploy.js');
const endpoint_help = require('./endpoints/api/help.js');
const endpoint_monitoring = require('./endpoints/api/monitoring.js');
const endpoint_code = require('./endpoints/api/code.js');
const endpoint_ssh = require('./endpoints/api/ssh.js');
const endpoint_server = require('./endpoints/api/server.js');
const endpoint_memoryexport = require('./endpoints/api/memoryexport.js');
const endpoint_scheduler_monthly = require('./endpoints/api/scheduler/monthly.js');
const endpoint_scheduler_daily = require('./endpoints/api/scheduler/daily.js');
const endpoint_scheduler_hourly = require('./endpoints/api/scheduler/hourly.js');
const endpoint_discord_guild_create = require('./endpoints/api/discord/guild_create.js');
const endpoint_discord_guild_member_add = require('./endpoints/api/discord/guild_member_add.js');
const endpoint_discord_guild_member_update = require('./endpoints/api/discord/guild_member_update.js');
const endpoint_discord_guild_scheduled_event_create = require('./endpoints/api/discord/guild_scheduled_event_create.js');
const endpoint_discord_interaction_create = require('./endpoints/api/discord/interaction_create.js');
const endpoint_discord_message_create = require('./endpoints/api/discord/message_create.js');
const endpoint_discord_message_reaction_add = require('./endpoints/api/discord/message_reaction_add.js');
const endpoint_discord_message_reaction_remove = require('./endpoints/api/discord/message_reaction_remove.js');
const endpoint_discord_presence_update = require('./endpoints/api/discord/presence_update.js');
const endpoint_discord_typing_start = require('./endpoints/api/discord/typing_start.js');
const endpoint_discord_voice_audio = require('./endpoints/api/discord/voice_audio.js');
const endpoint_discord_voice_playback_finished = require('./endpoints/api/discord/voice_playback_finished.js');
const endpoint_discord_voice_reconnect = require('./endpoints/api/discord/voice_reconnect.js');
const endpoint_discord_voice_server_update = require('./endpoints/api/discord/voice_server_update.js');
const endpoint_discord_voice_state_update = require('./endpoints/api/discord/voice_state_update.js');
const discord = require('./shared/discord.js');

let revision = 0;
let revision_done = -1;
let revisions_done = [];
let operations = [];

main();

async function main() {
    /*
    let redirect_server = http.createServer((request, response) => redirectSafely(request, response));
    redirect_server.on('error', error => { console.error(error); shutdown(); });
    redirect_server.on('close', () => shutdown());
    redirect_server.listen(8080);
    console.log('HTTP REDIRECT SERVER ready');

    const options = {
        key: fs.readFileSync(process.env.HTTP_KEY_FILE ?? "server.key"),
        cert: fs.readFileSync(process.env.HTTP_CERT_FILE ?? "server.cert"),
    };
    let server = https.createServer(options, (request, response) => handleSafely(request, response));
    */
    let server = http.createServer((request, response) => handleSafely(request, response));
    server.on('error', error => { console.error(error); shutdown(); });
    server.on('close', () => shutdown());
    server.listen(process.env.PORT ?? 8080);
    setInterval(() => checkTimeout(server), 1000 * 60);
    console.log('HTTP SERVER ready');
}

/*
function redirectSafely(request, response) {
    try {
        identity.getPublicURL()
            .then(my_url_string => {
                let request_url = url.parse(request.url);
                response.writeHead(301, 'Moved Permanently', { 'content-type': 'text/plain', 'location': my_url_string + (request_url.pathname ?? '/') + (request_url.query ? '?' + request_url.query : '') });
                response.end();
            })
            .catch(error => {
                console.error(error);
                response.writeHead(500, 'Internal Server Error', { 'content-type': 'text/plain' });
                response.end()
            });
    } catch {
        console.error(`HTTP REDIRECT SERVER handling ${request.url} failed ` + error);
        response.writeHead(500, 'Internal Server Error', { 'content-type': 'text/plain' });
        response.end();
    }
}
*/

function handleSafely(request, response) {
    try {
        opentelemetry_api.trace.getActiveSpan()?.setAttribute('http.route', '*');
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
        opentelemetry_api.trace.getActiveSpan()?.setAttribute('http.route', path);
        response.writeHead(301, 'Moved Permanently', { location: '/index.html' });
        response.end();
        return;
    } else if (path.endsWith('/')) {
        response.writeHead(301, 'Moved Permanently', { location: path.substring(0, path.length - 1) });
        response.end();
        return;
    } else if (fs.existsSync('./endpoints/www/' + path)) {
        opentelemetry_api.trace.getActiveSpan()?.setAttribute('http.route', path);
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
        opentelemetry_api.trace.getActiveSpan()?.setAttribute('http.route', path);
        return dispatchAPI(path, params, headers, payload)
            .catch(error => {
                console.error(error.stack);
                opentelemetry_api.trace.getSpan(opentelemetry_api.context.active())?.recordException(error);
                return { status: 500, body: 'An internal error has occurred!' };
            })
            .then(result => {
                if (!result) {
                    result = { status: 200, body: 'Success' };
                }
                if (result.status == 404) opentelemetry_api.trace.getActiveSpan()?.setAttribute('http.route', '*');
                if (result.body) {
                    result.headers = result.headers ?? {};
                    if (result.headers['content-type'] && (result.headers['content-type'] == 'application/zip' || result.headers['content-type'].startsWith('image/'))) { // this should really be "if body is buffer"
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
                    opentelemetry_api.trace.getSpan(opentelemetry_api.context.active())?.setStatus({ code: opentelemetry_api.SpanStatusCode.ERROR });
                }
                response.writeHead(result.status, result.headers);
                if (result.body) {
                  if (result.body.pipe) {
                    result.body.pipe(response);
                    result.body.on('end', () => response.end());
                  } else {
                    response.write(result.body);
                    response.end();
                  }
                } else {
                  response.end();
                }
            });
    }
}

async function dispatchAPI(path, params, headers, payload) {
    if (path.startsWith('/discord/') && payload?.callback) discord.register_callback(payload.callback.guild_id, payload.callback.url);
    switch (path) {
        case '/favicon.ico': return favicon.handle();
        case '/about': return endpoint_about.handle();
        case '/privacy': return endpoint_privacy.handle();
        case '/autorefresh': return endpoint_autorefresh.handle(params, headers);
        case '/configure': return endpoint_configure.handle();
        case '/debug': return endpoint_debug.handle();
        case '/invite': return endpoint_invite.handle();
        case '/deploy': return endpoint_deploy.handle();
        case '/help': return endpoint_help.handle();
        case '/monitoring': return endpoint_monitoring.handle();
        case '/code': return endpoint_code.handle();
        case '/ssh': return endpoint_ssh.handle();
        case '/server': return endpoint_server.handle();
        // case '/memoryexport': return endpoint_memoryexport.handle();
        case '/scheduler/monthly': return dispatchAPIAuthorized(headers, () => endpoint_scheduler_monthly.handle());
        case '/scheduler/daily': return dispatchAPIAuthorized(headers, () => endpoint_scheduler_daily.handle());
        case '/scheduler/hourly': return dispatchAPIAuthorized(headers, () => endpoint_scheduler_hourly.handle());
        case '/scheduler/minutely': return undefined;
        case '/discord/guild_create': return dispatchAPIAuthorized(headers, () => endpoint_discord_guild_create.handle(payload));
        case '/discord/guild_member_add': return dispatchAPIAuthorized(headers, () => endpoint_discord_guild_member_add.handle(payload));
        case '/discord/guild_member_update': return dispatchAPIAuthorized(headers, () => endpoint_discord_guild_member_update.handle(payload));
        case '/discord/guild_scheduled_event_create': return dispatchAPIAuthorized(headers, () => endpoint_discord_guild_scheduled_event_create.handle(payload));
        case '/discord/interaction_create': return dispatchAPIAuthorized(headers, () => endpoint_discord_interaction_create.handle(payload));
        case '/discord/message_create': return dispatchAPIAuthorized(headers, () => endpoint_discord_message_create.handle(payload));
        case '/discord/message_reaction_add': return dispatchAPIAuthorized(headers, () => endpoint_discord_message_reaction_add.handle(payload));
        case '/discord/message_reaction_remove': return dispatchAPIAuthorized(headers, () => endpoint_discord_message_reaction_remove.handle(payload));
        case '/discord/presence_update': return dispatchAPIAuthorized(headers, () => endpoint_discord_presence_update.handle(payload));
        case '/discord/typing_start': return dispatchAPIAuthorized(headers, () => endpoint_discord_typing_start.handle(payload));
        case '/voice_callback/voice_audio': return dispatchAPIAuthorized(headers, () => endpoint_discord_voice_audio.handle(payload));
        case '/voice_callback/voice_playback_finished': return dispatchAPIAuthorized(headers, () => endpoint_discord_voice_playback_finished.handle(payload));
        case '/voice_callback/voice_reconnect': return dispatchAPIAuthorized(headers, () => endpoint_discord_voice_reconnect.handle(payload));
        case '/discord/voice_server_update': return dispatchAPIAuthorized(headers, () => endpoint_discord_voice_server_update.handle(payload));
        case '/discord/voice_state_update': return dispatchAPIAuthorized(headers, () => endpoint_discord_voice_state_update.handle(payload));
        default:
          if(path.startsWith('/discord/')) {
            opentelemetry_api.trace.getActiveSpan()?.setAttribute('http.route', '/discord/*');
            return { status: 200, body: 'OK' };
          } else return { status: 404, body: 'Not found' };
    }
}

async function dispatchAPIAuthorized(headers, func) {
    if (!headers['x-authorization']) return { status: 401, body: 'Unauthorized' };
    if (headers['x-authorization'] != process.env.DISCORD_API_TOKEN) return { status: 403, body: 'Forbidden' };
    return func();
}

async function shutdown() {
    console.log('HTTP SERVER shutting down');
    process.exit(0);
}

async function checkTimeout(server) {
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

