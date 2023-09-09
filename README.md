This is Philbot, a Discord Bot. See features here: http://philbot.eu/help

To deploy, select one the the deb packages from here: https://github.com/plengauer/Philbot/releases.
The deployment packages ONLY take care of deployment, the Bot itself will auto-update.
Currently, there are two deployment models supported:
baremetal (install all dependencies on the system, slightly reduced downtime when auto-updating, enables fine-grained control over individual services, ideal to get to know it and to experiment) and
containerized (install all tiers as docker containers, less cluttered, discord shards manually scalable in case discord enforces sharding due to much usage). Kubernetes deployment will come soon.

While this Bot enjoys increased popularity (about 800 users as of September 2023), it also serves as a learning platform for its developers.
We intentionally choose a new technology for every tier and some aspects are implemented manually even though off-the-shelf packages would be readily available. 
