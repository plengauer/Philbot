CONTAINER_CACHE_DIRECTORY=audio_cache
HOST_CACHE_DIRECTORY=.philbot_voice_$CONTAINER_CACHE_DIRECTORY
mkdir -p $HOST_CACHE_DIRECTORY &&
exec sudo docker run \
    --user $(id -u):$(id -g) \
    --network="host" \
    --env PORT=12345 \
    --env-file environment.properties.voice \
    --env CACHE_DIRECTORY=/$CONTAINER_CACHE_DIRECTORY \
    --mount type=bind,source=$(pwd)/$HOST_CACHE_DIRECTORY,target=/$CONTAINER_CACHE_DIRECTORY \
    philipplengauer/philbot-voice:latest