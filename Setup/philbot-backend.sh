CONTAINER_MEMORY_DIRECTORY=memory
HOST_MEMORY_DIRECTORY=.philbot_backend_$CONTAINER_MEMORY_DIRECTORY
mkdir -p $HOST_MEMORY_DIRECTORY &&
sudo exec docker run -d philipplengauer/philbot-backend:latest \
    -env-file environment.properties.backend \
    --mount type=bind,source=$HOST_MEMORY_DIRECTORY,target=$CONTAINER_MEMORY_DIRECTORY
