#!/bin/bash
set -e
source /usr/bin/philbot_containerized_init_otel.sh

source /opt/philbot/shards

start() {
    name=$1
    image=$2
    docker pull philipplengauer/philbot-$image:latest
    if [ "$(docker ps --format '{{.Names}}' | grep $name)" ]; then
      image_digest=$(docker image inspect --format='{{json .Id}}' "philipplengauer/philbot-$image:latest" | tr -d '"')
      instance_digest=$(docker inspect --format='{{json .Image}}' $name | tr -d '"')
      if [ "$image_digest" = "$instance_digest" ]; then
        return 0
      fi
      docker stop $name
      docker rm $name
    fi
    docker create \
        --name $name \
        --restart unless-stopped \
        --network=host \
        --env-file /var/lib/philbot/environment.properties.$image \
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

start discordgateway2httpmaster discordgateway2httpmaster \
    --env PORT=7999

for shard_index in $(seq 0 $(($SHARD_COUNT-1)))
do
    start discordgateway2http_$shard_index discordgateway2http \
        --env SHARD_INDEX=auto --env SHARD_COUNT=auto \
        --env BASE_PORT=8081 \
        --env SHARDS_MASTER_PORT=7999 \
        --env FORWARD_PORT=8080 \
        --env STATE_STORAGE_DIRECTORY=/sessions \
        --mount type=bind,source=/var/lib/philbot/gateway_sessions,target=/sessions
done

start scheduler scheduler \
    --env CONFIG_FILE=/config.properties \
    --mount type=bind,source=/var/lib/philbot/config.properties.scheduler,target=/config.properties,readonly

docker image prune --force
