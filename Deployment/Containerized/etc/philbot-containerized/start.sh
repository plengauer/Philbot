#!/bin/bash
set -e

start() {
    name=$1
    docker create \
        --name $name \
        --restart unless-stopped \
        --network=host \
        --env-file /etc/philbot-containerized/environment.properties.$name \
        "${@:2}" \
        --init philipplengauer/philbot-$name:latest
    # TODO remove host network, map ports properly, and use bridge network interface so communication works
    docker start $name
}

start voice \
    --env PORT=12345 \
    --env STATE_STORAGE_DIRECTORY=/sessions \
    --mount type=bind,source=/var/lib/philbot/voice_sessions,target=/sessions \
    --env CACHE_DIRECTORY=/cache \
    --mount type=bind,source=/var/lib/philbot/audio_cache,target=/cache

start backend \
    --env PORT=8080 \
    --env VOICE_PORT=12345 \
    --env MEMORY_DIRECTORY=/memory \
    --mount type=bind,source=/var/lib/philbot/memory,target=/memory

start discordgateway2http \
    --env SHARD_INDEX=0 --env SHARD_COUNT=1 \
    --env PORT=8081 \
    --env STATE_STORAGE_DIRECTORY=/sessions \
    --mount type=bind,source=/var/lib/philbot/gateway_sessions,target=/sessions

start scheduler \
    --env CONFIG_FILE=/config.properties \
    --mount type=bind,source=/etc/config.properties.scheduler,target=/config.properties,readonly