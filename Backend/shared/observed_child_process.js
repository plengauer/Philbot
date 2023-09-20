const opentelemetry = require('@opentelemetry/api');
const { HttpTraceContext } = require('@opentelemetry/core');
const child_process = require('child_process');

const tracer = opentelemetry.trace.getTracer("child_process");

function spawn(command, args, options) {
    const span = tracer.startSpan(`${command} ${args ? args.join(' ') : ''}`);
    span.setAttribute('subprocess.command', command + (args ? ' ' + args.join(' ') : ''));
    span.setAttribute('subprocess.command_args', args.join(' '));
    span.setAttribute('subprocess.executable.path', command);
    span.setAttribute('subprocess.executable.name', command.includes('/') ? command.substring(command.lastIndexOf('/')) : command);
    return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => {
        const headers = {};
        tracer.context().inject(opentelemetry.context.active(), headers, new HttpTraceContext());
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
