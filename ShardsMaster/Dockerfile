FROM eclipse-temurin:latest
ARG APPLICATION_VERSION
SHELL ["/bin/bash", "-c"]
WORKDIR /application

COPY src/ .
RUN wget https://repo1.maven.org/maven2/io/opentelemetry/opentelemetry-api/1.29.0/opentelemetry-api-1.29.0.jar
RUN wget https://repo1.maven.org/maven2/io/opentelemetry/opentelemetry-context/1.9.1/opentelemetry-context-1.9.1.jar
RUN javac -cp *.jar eu/philbot/*.java && rm eu/philbot/*.java
RUN wget https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar

ENV PORT=8080

ENV SERVICE_NAME="Philbot ShardsMaster"
ENV SERVICE_VERSION=$APPLICATION_VERSION

CMD exec java -Xmx25m \
    -Dotel.service.name="$SERVICE_NAME" -Dotel.service.version=$SERVICE_VERSION \
    -Dotel.traces.exporter=otlp -Dotel.exporter.otlp.traces.protocol=http/protobuf \
    -Dotel.exporter.otlp.traces.endpoint=$OPENTELEMETRY_TRACES_API_ENDPOINT \
    -Dotel.exporter.otlp.traces.headers="Authorization=Api-Token "$OPENTELEMETRY_TRACES_API_TOKEN \
    -Dotel.metrics.exporter=otlp -Dotel.exporter.otlp.metrics.protocol=http/protobuf \
    -Dotel.exporter.otlp.metrics.endpoint=$OPENTELEMETRY_METRICS_API_ENDPOINT \
    -Dotel.exporter.otlp.metrics.headers="Authorization=Api-Token "$OPENTELEMETRY_METRICS_API_TOKEN \
    -javaagent:./opentelemetry-javaagent.jar \
    -cp . eu.philbot.ShardsMaster

EXPOSE 8080/tcp