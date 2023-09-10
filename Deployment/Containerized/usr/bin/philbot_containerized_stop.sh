#!/bin/bash
shard_count=$(bash /usr/bin/philbot_containerized_shard_count.sh 2>&1)
shard_container_names=$(echo discordgateway2http_$(seq -s " discordgateway2http_" 0 $(($shard_count-1))))
docker stop voice backend $shard_container_names scheduler
docker rm voice backend $shard_container_names scheduler
docker image prune -a --force
exit 0