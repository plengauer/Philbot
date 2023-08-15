sudo exec docker run -d philipplengauer/philbot-discordgateway2http:latest \
    -env-file environment.properties.discordgateway2http
    --env SHARD_INDEX=$SHARD_INDEX
    --env SHARD_COUNT=$SHARD_COUNT
    --env PORT=8080
    -p 127.0.0.1:$((8081 + $SHARD_INDEX)):8080
