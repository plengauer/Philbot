CONTAINER_MEMORY_DIRECTORY=memory
HOST_MEMORY_DIRECTORY=.philbot_backend_$CONTAINER_MEMORY_DIRECTORY
mkdir -p $HOST_MEMORY_DIRECTORY &&
exec sudo docker run \
    --user $(id -u):$(id -g) \
    --network="host" \
    --env PORT=8080 \
    --env VOICE_PORT=12345 \
    --env-file environment.properties.backend \
    --env MEMORY_DIRECTORY=/$CONTAINER_MEMORY_DIRECTORY \
    --mount type=bind,source=$(pwd)/$HOST_MEMORY_DIRECTORY,target=/$CONTAINER_MEMORY_DIRECTORY \
    philipplengauer/philbot-backend:latest