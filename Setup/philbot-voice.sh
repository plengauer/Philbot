CONTAINER_CACHE_DIRECTORY=audio_cache
HOST_CACHE_DIRECTORY=.philbot_voice_$CONTAINER_CACHE_DIRECTORY
mkdir -p $HOST_CACHE_DIRECTORY &&
sudo exec docker run -d philipplengauer/philbot-scheduler:latest \
    -env-file environment.properties.voice \
    --env CACHE_DIRECTORY=$CONTAINER_CACHE_DIRECTORY \
    --mount type=bind,source=$HOST_CACHE_DIRECTORY,target=$CONTAINER_CACHE_DIRECTORY
