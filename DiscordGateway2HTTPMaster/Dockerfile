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

CMD exec sh -c ' \
export OTEL_SERVICE_NAME="Philbot Discord Gateway 2 HTTP Master" \
export OTEL_RESOURCE_ATTRIBUTES=service.namespace="Philbot",service.version=$(cat version.txt),service.instance.id=$(uuidgen) \
export OTEL_METRICS_EXPORTER=otlp \
export OTEL_EXPORTER_OTLP_METRICS_PROTOCOL=http/protobuf \
export OTEL_EXPORTER_OTLP_METRICS_ENDPOINT="$OPENTELEMETRY_METRICS_API_ENDPOINT" \
export OTEL_EXPORTER_OTLP_METRICS_HEADERS="Authorization=$OPENTELEMETRY_METRICS_API_TOKEN" \
export OTEL_TRACES_EXPORTER=otlp \
export OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf \
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="$OPENTELEMETRY_TRACES_API_ENDPOINT" \
export OTEL_EXPORTER_OTLP_TRACES_HEADERS="Authorization=$OPENTELEMETRY_TRACES_API_TOKEN" \
exec java -Xmx100m -XX:+ExitOnOutOfMemoryError -Djava.util.logging.config.file=logging.properties -javaagent:./opentelemetry-javaagent.jar -cp $(find . -name "*.jar" | paste -sd ":" -):. eu.philbot.DiscordGateway2HTTPMaster'

EXPOSE 8080/tcp
