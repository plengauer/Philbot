#!/bin/bash
set -e
destination_directory=/var/lib/philbot
. /usr/share/debconf/confmodule

value() {
    db_get philbot/"$@"
    echo "$RET"
}

config() {
    echo "$@=$(value $@)"
}

kvp_deployment=$(config DEPLOYMENT | sed 's/DEPLOYMENT/deployment.environment/g')
kvp_application_id=$(config DISCORD_CLIENT_ID | sed 's/DISCORD_CLIENT_ID/discord.application.id/g')
resource_attributes=OTEL_RESOURCE_ATTRIBUTES=$kvp_application_id,$kvp_deployment

echo $resource_attributes >> $destination_directory/environment.properties.selfmonitoring
echo $resource_attributes >> $destination_directory/environment.properties.scheduler
echo $resource_attributes >> $destination_directory/environment.properties.discordgateway2http
echo $resource_attributes >> $destination_directory/environment.properties.discordgateway2httpmaster
echo $resource_attributes >> $destination_directory/environment.properties.backend
echo $resource_attributes >> $destination_directory/environment.properties.voice
echo $resource_attributes >> $destination_directory/environment.properties.deployment
echo $(config DISCORD_API_TOKEN) >> $destination_directory/environment.properties.scheduler
echo $(config DISCORD_API_TOKEN) >> $destination_directory/environment.properties.discordgateway2http
echo $(config DISCORD_API_TOKEN) >> $destination_directory/environment.properties.discordgateway2httpmaster
echo $(config DISCORD_API_TOKEN) >> $destination_directory/environment.properties.backend
echo $(config DISCORD_API_TOKEN) >> $destination_directory/environment.properties.voice
echo $(config DISCORD_API_TOKEN) >> $destination_directory/environment.properties.deployment
echo $(config OPENTELEMETRY_TRACES_API_ENDPOINT) >> $destination_directory/environment.properties.scheduler
echo $(config OPENTELEMETRY_TRACES_API_ENDPOINT) >> $destination_directory/environment.properties.discordgateway2http
echo $(config OPENTELEMETRY_TRACES_API_ENDPOINT) >> $destination_directory/environment.properties.discordgateway2httpmaster
echo $(config OPENTELEMETRY_TRACES_API_ENDPOINT) >> $destination_directory/environment.properties.backend
echo $(config OPENTELEMETRY_TRACES_API_ENDPOINT) >> $destination_directory/environment.properties.voice
echo $(config OPENTELEMETRY_TRACES_API_ENDPOINT) >> $destination_directory/environment.properties.deployment
echo $(config OPENTELEMETRY_TRACES_API_TOKEN) >> $destination_directory/environment.properties.scheduler
echo $(config OPENTELEMETRY_TRACES_API_TOKEN) >> $destination_directory/environment.properties.discordgateway2http
echo $(config OPENTELEMETRY_TRACES_API_TOKEN) >> $destination_directory/environment.properties.discordgateway2httpmaster
echo $(config OPENTELEMETRY_TRACES_API_TOKEN) >> $destination_directory/environment.properties.backend
echo $(config OPENTELEMETRY_TRACES_API_TOKEN) >> $destination_directory/environment.properties.voice
echo $(config OPENTELEMETRY_TRACES_API_TOKEN) >> $destination_directory/environment.properties.deployment
echo $(config OPENTELEMETRY_METRICS_API_ENDPOINT) >> $destination_directory/environment.properties.scheduler
echo $(config OPENTELEMETRY_METRICS_API_ENDPOINT) >> $destination_directory/environment.properties.discordgateway2http
echo $(config OPENTELEMETRY_METRICS_API_ENDPOINT) >> $destination_directory/environment.properties.discordgateway2httpmaster
echo $(config OPENTELEMETRY_METRICS_API_ENDPOINT) >> $destination_directory/environment.properties.backend
echo $(config OPENTELEMETRY_METRICS_API_ENDPOINT) >> $destination_directory/environment.properties.voice
echo $(config OPENTELEMETRY_METRICS_API_ENDPOINT) >> $destination_directory/environment.properties.deployment
echo $(config OPENTELEMETRY_METRICS_API_TOKEN) >> $destination_directory/environment.properties.scheduler
echo $(config OPENTELEMETRY_METRICS_API_TOKEN) >> $destination_directory/environment.properties.discordgateway2http
echo $(config OPENTELEMETRY_METRICS_API_TOKEN) >> $destination_directory/environment.properties.discordgateway2httpmaster
echo $(config OPENTELEMETRY_METRICS_API_TOKEN) >> $destination_directory/environment.properties.backend
echo $(config OPENTELEMETRY_METRICS_API_TOKEN) >> $destination_directory/environment.properties.voice
echo $(config OPENTELEMETRY_METRICS_API_TOKEN) >> $destination_directory/environment.properties.deployment
echo $(config OPENTELEMETRY_LOGS_API_ENDPOINT) >> $destination_directory/environment.properties.scheduler
echo $(config OPENTELEMETRY_LOGS_API_ENDPOINT) >> $destination_directory/environment.properties.discordgateway2http
echo $(config OPENTELEMETRY_LOGS_API_ENDPOINT) >> $destination_directory/environment.properties.discordgateway2httpmaster
echo $(config OPENTELEMETRY_LOGS_API_ENDPOINT) >> $destination_directory/environment.properties.backend
echo $(config OPENTELEMETRY_LOGS_API_ENDPOINT) >> $destination_directory/environment.properties.voice
echo $(config OPENTELEMETRY_LOGS_API_ENDPOINT) >> $destination_directory/environment.properties.deployment
echo $(config OPENTELEMETRY_LOGS_API_TOKEN) >> $destination_directory/environment.properties.scheduler
echo $(config OPENTELEMETRY_LOGS_API_TOKEN) >> $destination_directory/environment.properties.discordgateway2http
echo $(config OPENTELEMETRY_LOGS_API_TOKEN) >> $destination_directory/environment.properties.discordgateway2httpmaster
echo $(config OPENTELEMETRY_LOGS_API_TOKEN) >> $destination_directory/environment.properties.backend
echo $(config OPENTELEMETRY_LOGS_API_TOKEN) >> $destination_directory/environment.properties.voice
echo $(config OPENTELEMETRY_LOGS_API_TOKEN) >> $destination_directory/environment.properties.deployment
echo $(config DISCORD_CLIENT_ID) >> $destination_directory/environment.properties.backend
echo $(config OWNER_DISCORD_USER_ID) >> $destination_directory/environment.properties.backend
echo $(config PUBLIC_URL) >> $destination_directory/environment.properties.backend
echo $(config OPENAI_API_TOKEN) >> $destination_directory/environment.properties.backend
echo $(config OPENAI_COST_LIMIT) >> $destination_directory/environment.properties.backend
echo $(config GCP_T2S_TOKEN) >> $destination_directory/environment.properties.backend
echo $(config GOOGLEAI_COST_LIMIT) >> $destination_directory/environment.properties.backend
echo $(config SPEECHIFY_API_TOKEN) >> $destination_directory/environment.properties.backend
echo $(config SPEECHIFY_COST_LIMIT) >> $destination_directory/environment.properties.backend
echo $(config RIOT_API_TOKEN) >> $destination_directory/environment.properties.backend
echo $(config RIOT_TFT_API_TOKEN) >> $destination_directory/environment.properties.backend
echo $(config RAPID_API_TOKEN) >> $destination_directory/environment.properties.backend
echo $(config APEX_LEGENDS_API_TOKEN) >> $destination_directory/environment.properties.backend
echo $(config TRACKER_GG_API_TOKEN) >> $destination_directory/environment.properties.backend
echo $(config YOUTUBE_API_TOKEN) >> $destination_directory/environment.properties.backend
echo $(config LINK_OBSERVABILITY) >> $destination_directory/environment.properties.backend

if [ "$(config SELF_MONITORING)" != "yes" ]; then
  endpoint_logs="$(value OPENTELEMETRY_LOGS_API_ENDPOINT)"
  endpoint_metrics="$(value OPENTELEMETRY_METRICS_API_ENDPOINT)"
  endpoint_traces="$(value OPENTELEMETRY_TRACES_API_ENDPOINT)"
  header_logs="$(value OPENTELEMETRY_LOGS_API_TOKEN)"
  header_metrics="$(value OPENTELEMETRY_METRICS_API_TOKEN)"
  header_traces="$(value OPENTELEMETRY_TRACES_API_TOKEN)"
  cat /var/lib/philbot-config/collector.yaml \
    | sed 's~\$ENDPOINT_LOGS~'"$endpoint_logs"'~g' \
    | sed 's~\$ENDPOINT_METRICS~'"$endpoint_metrics"'~g' \
    | sed 's~\$ENDPOINT_TRACES~'"$endpoint_traces"'~g' \
    | sed 's~\$HEADER_LOGS~'"$header_logs"'~g' \
    | sed 's~\$HEADER_METRICS~'"$header_metrics"'~g' \
    | sed 's~\$HEADER_TRACES~'"$header_traces"'~g' > $destination_directory/collector.yaml
fi