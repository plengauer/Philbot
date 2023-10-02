const opentelemetry = require('@opentelemetry/api');
const child_process = require('child_process');

const tracer = opentelemetry.trace.getTracer("philbot-backend/child_process");

function spawn(command, args, options) {
    if (false && (!options.stdio || options.stdio.length > 3)) {
        args = [ '-c', `. /usr/bin/opentelemetry_shell.sh; ${command} ` + args.map(arg => `"${arg}"`).join(' ') ];
        command = 'sh';
    }
    const span = tracer.startSpan(`${command} ${args ? args.join(' ') : ''}`);
    span.setAttribute('subprocess.command', command + (args ? ' ' + args.join(' ') : ''));
    span.setAttribute('subprocess.command_args', args.join(' '));
    span.setAttribute('subprocess.executable.path', command.includes('/') ? command : undefined);
    span.setAttribute('subprocess.executable.name', command.includes('/') ? command.substring(command.lastIndexOf('/')) : command);
    return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
        const headers = {};
        opentelemetry.propagation.inject(opentelemetry.context.active(), headers);
        const env = options && options.env || {};
        env['OTEL_TRACEPARENT'] = headers['traceparent'];
        const child = child_process.spawn(command, args, { ...options, env });
        child.on('exit', function (code) {
            span.setAttribute('subprocess.exit_code', code);
            span.end();
        });
        return child;
    });
}

module.exports = { spawn }
