#!/bin/bash
docker stop voice backend discordgateway2http scheduler
docker rm voice backend discordgateway2http scheduler
docker image prune -a --force
exit 0