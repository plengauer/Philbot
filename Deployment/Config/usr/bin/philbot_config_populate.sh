#!/bin/bash
set -e
destination_directory=$1
. /usr/share/debconf/confmodule

config() {
    db_get philbot/"$@"
    echo "$@=$RET"
}

kvp_deployment=$(config DEPLOYMENT | sed 's/DEPLOYMENT/deployment.environment/g')
kvp_application_id=$(config DISCORD_CLIENT_ID | sed 's/DISCORD_CLIENT_ID/discord.application.id/g')
resource_attributes=OTEL_RESOURCE_ATTRIBUTES=$kvp_application_id,$kvp_deployment

echo $resource_attributes >> $destination_directory/environment.properties.scheduler
echo $resource_attributes >> $destination_directory/environment.properties.discordgateway2http
echo $resource_attributes >> $destination_directory/environment.properties.backend
echo $resource_attributes >> $destination_directory/environment.properties.voice
echo $resource_attributes >> $destination_directory/environment.properties.deployment
echo $(config DISCORD_API_TOKEN) >> $destination_directory/environment.properties.scheduler
echo $(config DISCORD_API_TOKEN) >> $destination_directory/environment.properties.discordgateway2http
echo $(config DISCORD_API_TOKEN) >> $destination_directory/environment.properties.backend
echo $(config DISCORD_API_TOKEN) >> $destination_directory/environment.properties.voice
echo $(config DISCORD_API_TOKEN) >> $destination_directory/environment.properties.deployment
echo $(config OPENTELEMETRY_TRACES_API_ENDPOINT) >> $destination_directory/environment.properties.scheduler
echo $(config OPENTELEMETRY_TRACES_API_ENDPOINT) >> $destination_directory/environment.properties.discordgateway2http
echo $(config OPENTELEMETRY_TRACES_API_ENDPOINT) >> $destination_directory/environment.properties.backend
echo $(config OPENTELEMETRY_TRACES_API_ENDPOINT) >> $destination_directory/environment.properties.voice
echo $(config OPENTELEMETRY_TRACES_API_ENDPOINT) >> $destination_directory/environment.properties.deployment
echo $(config OPENTELEMETRY_TRACES_API_TOKEN) >> $destination_directory/environment.properties.scheduler
echo $(config OPENTELEMETRY_TRACES_API_TOKEN) >> $destination_directory/environment.properties.discordgateway2http
echo $(config OPENTELEMETRY_TRACES_API_TOKEN) >> $destination_directory/environment.properties.backend
echo $(config OPENTELEMETRY_TRACES_API_TOKEN) >> $destination_directory/environment.properties.voice
echo $(config OPENTELEMETRY_TRACES_API_TOKEN) >> $destination_directory/environment.properties.deployment
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
