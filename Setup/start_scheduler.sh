sudo docker run -d philipplengauer/philbot-scheduler:latest --env ./environment.properties.scheduler --mount type=bind,source="$(pwd)"/config.properties.scheduler,target=/config.properties,readonly
