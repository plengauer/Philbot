#!/bin/bash
source /var/lib/philbot/environment.properties.deployment
if [ -f /usr/bin/opentelemetry_shell.sh ]; then
  export OTEL_SERVICE_NAME="Philbot Deployment"
  export OTEL_RESOURCE_ATTRIBUTES="$OTEL_RESOURCE_ATTRIBUTES,service.namespace=Philbot,service.version="$(apt show philbot-containerized 2> /dev/null | grep Version | awk '{ print $2 }')
  export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="$OPENTELEMETRY_TRACES_API_ENDPOINT"
  export OTEL_EXPORTER_OTLP_TRACES_HEADERS=authorization=$(echo "$OPENTELEMETRY_TRACES_API_TOKEN" | jq -Rr @uri)
  source /usr/bin/opentelemetry_shell.sh
fi
