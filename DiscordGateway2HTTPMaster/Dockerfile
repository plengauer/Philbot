FROM ubuntu:rolling AS downloader
WORKDIR /downloads
RUN apt-get update && apt-get install -y wget
# this is super anti-pattern, fix with a proper maven project
RUN wget https://repo1.maven.org/maven2/io/opentelemetry/opentelemetry-api/1.29.0/opentelemetry-api-1.29.0.jar
RUN wget https://repo1.maven.org/maven2/io/opentelemetry/opentelemetry-context/1.9.1/opentelemetry-context-1.9.1.jar
RUN wget https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar
RUN wget https://repo1.maven.org/maven2/io/opentelemetry/contrib/opentelemetry-aws-resources/1.29.0-alpha/opentelemetry-aws-resources-1.29.0-alpha.jar


# FROM amazoncorretto:20
FROM eclipse-temurin:latest
SHELL ["/bin/bash", "-c"]
WORKDIR /application

COPY --from=downloader /downloads/ ./
COPY version.txt logging.properties src/ ./
RUN javac -cp $(find . -name '*.jar' | paste -sd ":" -) eu/philbot/*.java && rm eu/philbot/*.java

ENV PORT=8080

CMD exec java -Xmx100m -XX:+ExitOnOutOfMemoryError \
    -Djava.util.logging.config.file=logging.properties \
    -Dotel.service.name="Philbot Discord Gateway 2 HTTP Master" \
    -Dotel.resource.attributes=service.namespace="Philbot",service.version=$(cat version.txt),service.instance.id=$(uuidgen) \
    -Dotel.traces.exporter=otlp -Dotel.exporter.otlp.traces.protocol=http/protobuf \
    -Dotel.exporter.otlp.traces.endpoint=$OPENTELEMETRY_TRACES_API_ENDPOINT \
    -Dotel.exporter.otlp.traces.headers="Authorization=$OPENTELEMETRY_TRACES_API_TOKEN" \
    -Dotel.metrics.exporter=otlp -Dotel.exporter.otlp.metrics.protocol=http/protobuf \
    -Dotel.exporter.otlp.metrics.endpoint=$OPENTELEMETRY_METRICS_API_ENDPOINT \
    -Dotel.exporter.otlp.metrics.headers="Authorization=$OPENTELEMETRY_METRICS_API_TOKEN" \
    -javaagent:./opentelemetry-javaagent.jar \
    -cp $(find . -name '*.jar' | paste -sd ":" -):. eu.philbot.DiscordGateway2HTTPMaster

EXPOSE 8080/tcp
