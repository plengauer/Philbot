sudo docker run -d philipplengauer/philbot-backend:latest --env ./environment.properties.backend --mount type=bind,source="$(pwd)"/memory,target=/memory
