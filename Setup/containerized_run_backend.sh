CONTAINER_MEMORY_DIRECTORY=memory
HOST_MEMORY_DIRECTORY=.philbot_backend_$CONTAINER_MEMORY_DIRECTORY
mkdir -p $HOST_MEMORY_DIRECTORY &&
sudo docker run -d philipplengauer/philbot-backend:latest \
    -env-file environment.properties.backend \
    --env MEMORY_DIRECTORY=$CONTAINER_MEMORY_DIRECTORY \
    --mount type=bind,source=$HOST_MEMORY_DIRECTORY,target=$CONTAINER_MEMORY_DIRECTORY \
    --env PORT=8080 \
    -p 8080:8080
