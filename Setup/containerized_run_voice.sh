CONTAINER_CACHE_DIRECTORY=audio_cache
HOST_CACHE_DIRECTORY=.philbot_voice_$CONTAINER_CACHE_DIRECTORY
mkdir -p $HOST_CACHE_DIRECTORY &&
exec sudo docker run \
    --user $(id -u):$(id -g) \
    --network="host" \
    --env-file environment.properties.voice \
    --env CACHE_DIRECTORY=/$CONTAINER_CACHE_DIRECTORY \
    --mount type=bind,source=$(pwd)/$HOST_CACHE_DIRECTORY,target=/$CONTAINER_CACHE_DIRECTORY \
    -p 127.0.0.1:12345:8080 \
    -p 1-65535:1-65535/udp \
    philipplengauer/philbot-scheduler:latest