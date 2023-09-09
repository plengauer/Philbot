#!/bin/bash
set -e
destination_directory=$1
. /usr/share/debconf/confmodule

config() {
    db_get philbot/"$@"
    echo "$@=$RET"
}

echo "" >> $destination_directory/environment.properties.scheduler
echo "" >> $destination_directory/environment.properties.discordgateway2http
echo "" >> $destination_directory/environment.properties.backend
echo "" >> $destination_directory/environment.properties.voice
echo $(config DEPLOYMENT) | sed 's/DEPLOYMENT/OTEL_RESOURCE_ATTRIBUTES=deployment.environment/g' >> $destination_directory/environment.properties.scheduler
echo $(config DEPLOYMENT) | sed 's/DEPLOYMENT/OTEL_RESOURCE_ATTRIBUTES=deployment.environment/g' >> $destination_directory/environment.properties.discordgateway2http
echo $(config DEPLOYMENT) | sed 's/DEPLOYMENT/OTEL_RESOURCE_ATTRIBUTES=deployment.environment/g' >> $destination_directory/environment.properties.backend
echo $(config DEPLOYMENT) | sed 's/DEPLOYMENT/OTEL_RESOURCE_ATTRIBUTES=deployment.environment/g' >> $destination_directory/environment.properties.voice
echo $(config DISCORD_API_TOKEN) >> $destination_directory/environment.properties.scheduler
echo $(config DISCORD_API_TOKEN) >> $destination_directory/environment.properties.discordgateway2http
echo $(config DISCORD_API_TOKEN) >> $destination_directory/environment.properties.backend
echo $(config DISCORD_API_TOKEN) >> $destination_directory/environment.properties.voice
echo $(config OPENTELEMETRY_TRACES_API_ENDPOINT) >> $destination_directory/environment.properties.scheduler
echo $(config OPENTELEMETRY_TRACES_API_ENDPOINT) >> $destination_directory/environment.properties.discordgateway2http
echo $(config OPENTELEMETRY_TRACES_API_ENDPOINT) >> $destination_directory/environment.properties.backend
echo $(config OPENTELEMETRY_TRACES_API_ENDPOINT) >> $destination_directory/environment.properties.voice
echo $(config OPENTELEMETRY_TRACES_API_TOKEN) >> $destination_directory/environment.properties.scheduler
echo $(config OPENTELEMETRY_TRACES_API_TOKEN) >> $destination_directory/environment.properties.discordgateway2http
echo $(config OPENTELEMETRY_TRACES_API_TOKEN) >> $destination_directory/environment.properties.backend
echo $(config OPENTELEMETRY_TRACES_API_TOKEN) >> $destination_directory/environment.properties.voice
echo $(config OPENTELEMETRY_METRICS_API_ENDPOINT) >> $destination_directory/environment.properties.scheduler
echo $(config OPENTELEMETRY_METRICS_API_ENDPOINT) >> $destination_directory/environment.properties.discordgateway2http
echo $(config OPENTELEMETRY_METRICS_API_ENDPOINT) >> $destination_directory/environment.properties.backend
echo $(config OPENTELEMETRY_METRICS_API_ENDPOINT) >> $destination_directory/environment.properties.voice
echo $(config OPENTELEMETRY_METRICS_API_TOKEN) >> $destination_directory/environment.properties.scheduler
echo $(config OPENTELEMETRY_METRICS_API_TOKEN) >> $destination_directory/environment.properties.discordgateway2http
echo $(config OPENTELEMETRY_METRICS_API_TOKEN) >> $destination_directory/environment.properties.backend
echo $(config OPENTELEMETRY_METRICS_API_TOKEN) >> $destination_directory/environment.properties.voice
echo $(config DISCORD_CLIENT_ID) >> $destination_directory/environment.properties.backend
echo $(config OWNER_DISCORD_USER_ID) >> $destination_directory/environment.properties.backend
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