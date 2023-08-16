CONTAINER_SESSIONS_DIRECTORY=sessions
HOST_SESSIONS_DIRECTORY=.philbot_discordgateway2http_$CONTAINER_SESSIONS_DIRECTORY
mkdir -p $HOST_SESSIONS_DIRECTORY &&
sudo exec docker run -d philipplengauer/philbot-discordgateway2http:latest \
    -env-file environment.properties.discordgateway2http \
    --mount type=bind,source=$HOST_SESSIONS_DIRECTORY,target=$CONTAINER_SESSIONS_DIRECTORY \
    --env SHARD_INDEX=$SHARD_INDEX \
    --env SHARD_COUNT=$SHARD_COUNT \
    --env PORT=8080 \
    -p 127.0.0.1:$((8081 + $SHARD_INDEX)):8080
