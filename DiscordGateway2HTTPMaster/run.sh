#!/bin/sh
export OTEL_SERVICE_NAME="Philbot Discord Gateway 2 HTTP Master"
export OTEL_RESOURCE_ATTRIBUTES=service.namespace="Philbot",service.version=$(cat VERSION),service.instance.id=$(uuidgen)
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_METRICS_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_METRICS_ENDPOINT="$OPENTELEMETRY_METRICS_API_ENDPOINT"
export OTEL_EXPORTER_OTLP_METRICS_HEADERS="Authorization=$OPENTELEMETRY_METRICS_API_TOKEN"
export OTEL_TRACES_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="$OPENTELEMETRY_TRACES_API_ENDPOINT"
export OTEL_EXPORTER_OTLP_TRACES_HEADERS="Authorization=$OPENTELEMETRY_TRACES_API_TOKEN"
JAR_FILE=DiscordGateway2HTTPMaster.jar
exec java -Xmx100m -XX:+ExitOnOutOfMemoryError -Djava.util.logging.config.file=logging.properties -javaagent:./opentelemetry-javaagent.jar -cp "$JAR_FILE" eu.philbot.DiscordGateway2HTTPMaster