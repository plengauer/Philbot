package eu.philbot;

import com.sun.net.httpserver.*;
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.Scope;
import io.opentelemetry.context.propagation.TextMapGetter;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

public class ObservableHttpHandler {

    private static final Tracer TRACER = GlobalOpenTelemetry.getTracer("jdk.httpserver");

    private static final TextMapGetter<HttpExchange> GETTER = new TextMapGetter<>() {
        @Override
        public String get(HttpExchange carrier, String key) {
            return carrier.getRequestHeaders().containsKey(key) ? carrier.getRequestHeaders().get(key).get(0) : null;
        }

        @Override
        public Iterable<String> keys(HttpExchange carrier) {
            return carrier.getRequestHeaders().keySet();
        }
    };

    public static HttpHandler observe(HttpHandler function) {
        return exchange -> {
            Context context = GlobalOpenTelemetry.get().getPropagators().getTextMapPropagator().extract(Context.current(), exchange, GETTER);
            try (Scope __ = context.makeCurrent()) {
                Span span = TRACER.spanBuilder(exchange.getRequestMethod()).setSpanKind(SpanKind.SERVER).startSpan();
                // span.setAttribute("http.flavor", "1.1");
                span.setAttribute("http.host", exchange.getLocalAddress().getHostString());
                span.setAttribute("http.method", exchange.getRequestMethod());
                span.setAttribute("http.route", exchange.getHttpContext().getPath());
                span.setAttribute("http.scheme", exchange.getProtocol());
                span.setAttribute("http.target", exchange.getHttpContext().getPath());
                span.setAttribute("http.url", exchange.getRequestURI().toURL().toString());
                span.setAttribute("http.user_agent", exchange.getRequestHeaders().getFirst("User-Agent"));
                span.setAttribute("net.host.ip", exchange.getLocalAddress().getAddress().toString());
                span.setAttribute("net.host.name", exchange.getLocalAddress().getHostName());
                span.setAttribute("net.host.port", exchange.getLocalAddress().getPort());
                span.setAttribute("net.peer.ip", exchange.getRemoteAddress().getAddress().toString());
                span.setAttribute("net.peer.port", exchange.getRemoteAddress().getPort());
                span.setAttribute("net.transport", "ip_tcp");
                InputStream in = new InputStream() {
                    private final InputStream inner = exchange.getRequestBody();

                    private int bytes = 0;

                    @Override
                    public int read() throws IOException {
                        int result = inner.read();
                        if (result >= 0) bytes++;
                        else span.setAttribute("http.request_content_length_uncompressed", bytes);
                        return result;
                    }
                };
                OutputStream out = new OutputStream() {
                    private final OutputStream inner = exchange.getResponseBody();
                    @Override
                    public void write(int b) throws IOException {
                        inner.write(b);
                    }

                    @Override
                    public void close() throws IOException {
                        try {
                            super.close();
                        } finally {
                            span.setAttribute("http.status_code", exchange.getResponseCode());
                            // span.setAttribute("http.status_text", "OK");
                            span.end();
                        }
                    }
                };
                exchange.setStreams(in, out);
                try {
                    function.handle(exchange);
                } catch (Throwable t) {
                    span.recordException(t);
                    throw t;
                }
            }
        };
    }

}
