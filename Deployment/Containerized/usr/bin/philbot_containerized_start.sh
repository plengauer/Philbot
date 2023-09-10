#!/bin/bash
set -e

shard_count=$(bash /usr/bin/philbot_containerized_shard_count.sh 2>&1)

start() {
    name=$1
    image=$2
    docker create \
        --name $name \
        --restart unless-stopped \
        --network=host \
        --env-file /etc/philbot-containerized/environment.properties.$image \
        "${@:3}" \
        --init philipplengauer/philbot-$image:latest
    # TODO remove host network, map ports properly, and use bridge network interface so communication works
    docker start $name
}

start voice voice \
    --env PORT=12345 \
    --env STATE_STORAGE_DIRECTORY=/sessions \
    --mount type=bind,source=/var/lib/philbot/voice_sessions,target=/sessions \
    --env CACHE_DIRECTORY=/cache \
    --mount type=bind,source=/var/lib/philbot/audio_cache,target=/cache

start backend backend \
    --env PORT=8080 \
    --env VOICE_PORT=12345 \
    --env MEMORY_DIRECTORY=/memory \
    --mount type=bind,source=/var/lib/philbot/memory,target=/memory

for shard_index in $(seq 0 $(($shard_count-1)))
do
    start discordgateway2http_$shard_index discordgateway2http \
        --env SHARD_INDEX=$shard_index --env SHARD_COUNT=$shard_count \
        --env PORT=$((8081 + $shard_index)) \
        --env STATE_STORAGE_DIRECTORY=/sessions \
        --mount type=bind,source=/var/lib/philbot/gateway_sessions,target=/sessions
done

start scheduler scheduler \
    --env CONFIG_FILE=/config.properties \
    --mount type=bind,source=/etc/philbot-containerized/config.properties.scheduler,target=/config.properties,readonly