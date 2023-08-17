BACKEND_PORT=8080
rm -rf ./config.properties.scheduler
echo 'minutely=http://127.0.0.1:'$BACKEND_PORT'/scheduler/minutely' >> ./config.properties.scheduler &&
echo 'hourly=http://127.0.0.1:'$BACKEND_PORT'/scheduler/hourly' >> ./config.properties.scheduler &&
echo 'daily=http://127.0.0.1:'$BACKEND_PORT'/scheduler/daily' >> ./config.properties.scheduler &&
echo 'monthly=http://127.0.0.1:'$BACKEND_PORT'/scheduler/monthly' >> ./config.properties.scheduler &&
exec sudo docker run \
    --user $(id -u):$(id -g) \
    --network="host" \
    --env-file environment.properties.scheduler \
    --env CONFIG_FILE=/config.properties \
    --mount type=bind,source=$(pwd)/config.properties.scheduler,target=/config.properties,readonly \
    philipplengauer/philbot-scheduler:latest