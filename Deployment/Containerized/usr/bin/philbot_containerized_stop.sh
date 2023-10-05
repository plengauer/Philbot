#!/bin/bash
source /usr/bin/philbot_containerized_init_otel.sh
source /opt/philbot/env
shard_container_names=$(echo discordgateway2http_$(seq -s " discordgateway2http_" 0 $(($SHARD_COUNT-1))))
docker stop voice backend $shard_container_names scheduler
docker rm voice backend $shard_container_names scheduler
exit 0
