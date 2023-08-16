CONTAINER_SESSIONS_DIRECTORY=sessions
HOST_SESSIONS_DIRECTORY=.philbot_discordgateway2http_$CONTAINER_SESSIONS_DIRECTORY
mkdir -p $HOST_SESSIONS_DIRECTORY &&
exec sudo docker run \
    --user $(id -u):$(id -g) \
    --network="host" \
    --env-file environment.properties.discordgateway2http \
    --env STATE_STORAGE_DIRECTORY=/$HOST_SESSIONS_DIRECTORY \
    --mount type=bind,source=$(pwd)/$HOST_SESSIONS_DIRECTORY,target=/$CONTAINER_SESSIONS_DIRECTORY \
    --env SHARD_INDEX=$SHARD_INDEX \
    --env SHARD_COUNT=$SHARD_COUNT \
    --env PORT=8080 \
    -p 127.0.0.1:$((8081 + $SHARD_INDEX)):8080 \
    philipplengauer/philbot-discordgateway2http:latest