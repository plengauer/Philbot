sudo docker run -d philipplengauer/philbot-scheduler:latest \
    -env-file environment.properties.scheduler \
    --env CONFIG_FILE=/config.properties \
    --mount type=bind,source=config.properties.scheduler,target=/config.properties,readonly
