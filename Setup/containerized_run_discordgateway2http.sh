CONTAINER_SESSIONS_DIRECTORY=sessions
HOST_SESSIONS_DIRECTORY=.philbot_discordgateway2http_$CONTAINER_SESSIONS_DIRECTORY
PORT=$((8081 + $SHARD_INDEX))
mkdir -p $HOST_SESSIONS_DIRECTORY &&
exec sudo docker run \
    --user $(id -u):$(id -g) \
    --network="host" \
    --env PORT=$PORT \
    --env-file environment.properties.discordgateway2http \
    --env STATE_STORAGE_DIRECTORY=/$CONTAINER_SESSIONS_DIRECTORY \
    --mount type=bind,source=$(pwd)/$HOST_SESSIONS_DIRECTORY,target=/$CONTAINER_SESSIONS_DIRECTORY \
    --env SHARD_INDEX=$SHARD_INDEX \
    --env SHARD_COUNT=$SHARD_COUNT \
    philipplengauer/philbot-discordgateway2http:latest