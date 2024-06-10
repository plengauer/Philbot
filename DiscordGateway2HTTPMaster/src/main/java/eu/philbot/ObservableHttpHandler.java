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

    private static final Tracer TRACER = GlobalOpenTelemetry.getTracer("jdk.httpserver", "1.4");

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
                span.setAttribute("network.transport", "tcp");
                span.setAttribute("network.protocol.name", exchange.getProtocol().split("/")[0].toLowerCase());
                span.setAttribute("network.protocol.version", exchange.getProtocol().split("/")[1]);
                span.setAttribute("network.local.address", exchange.getLocalAddress().getAddress().toString().substring(1));
                span.setAttribute("network.local.port", exchange.getLocalAddress().getPort());
                span.setAttribute("network.peer.address", exchange.getRemoteAddress().getAddress().toString().substring(1));
                span.setAttribute("network.peer.port", exchange.getRemoteAddress().getPort());
                span.setAttribute("server.address", exchange.getLocalAddress().getHostString());
                span.setAttribute("server.port", exchange.getLocalAddress().getPort());
                span.setAttribute("client.address", exchange.getRemoteAddress().getAddress().toString().substring(1));
                span.setAttribute("client.port", exchange.getRemoteAddress().getPort());
                span.setAttribute("http.request.method", exchange.getRequestMethod());
                span.setAttribute("http.route", exchange.getHttpContext().getPath());
                span.setAttribute("url.full",  exchange.getProtocol().split("/")[0].toLowerCase() + "://" + exchange.getRequestHeaders().getFirst("Host") + exchange.getRequestURI());
                span.setAttribute("url.scheme", exchange.getProtocol().split("/")[0].toLowerCase());
                span.setAttribute("url.path", exchange.getHttpContext().getPath());
                InputStream in = new InputStream() {
                    private final InputStream inner = exchange.getRequestBody();

                    private int bytes = 0;

                    @Override
                    public int read() throws IOException {
                        int result = inner.read();
                        if (result >= 0) bytes++;
                        else span.setAttribute("http.request.body.size", bytes);
                        return result;
                    }

                    @Override
                    public void close() throws IOException {
                        super.close();
                        inner.close();
                    }
                };
                OutputStream out = new OutputStream() {
                    private final OutputStream inner = exchange.getResponseBody();

                    private int bytes = 0;
                    
                    @Override
                    public void write(int b) throws IOException {
                        inner.write(b);
                        bytes++;
                    }

                    @Override
                    public void close() throws IOException {
                        try {
                            super.close();
                            inner.close();
                        } finally {
                            span.setAttribute("http.status_code", exchange.getResponseCode());
                            span.setAttribute("http.response.body.size", bytes);
                            span.end();
                        }
                    }
                };
                exchange.setStreams(in, out);
                try (Scope ___ = span.makeCurrent()) {
                    function.handle(exchange);
                } catch (Throwable t) {
                    span.recordException(t);
                    throw t;
                }
            }
        };
    }

}
