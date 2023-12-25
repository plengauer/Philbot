This is Philbot, a Discord Bot. Among other things, it can play music, give real-time hints for games, organize group events, and is fully AI-powered. See all features here: http://philbot.eu/help. Add it to your own Discord server with this link: http://philbot.eu/invite. It is SaaS hosted and free.

# Deployment
The bot is hosted by the maintainer and free to use. However, if you want to deploy and host it on your own infrastructure, select one of the deb packages from this repository `http://philbot.eu:8000/`.
The deployment packages ONLY take care of deployment, the Bot itself will auto-update.
Currently, there are two deployment models supported:
baremetal (install all dependencies on the system, slightly reduced downtime when auto-updating, enables fine-grained control over individual services, ideal to get to know it and to experiment, can serve up to 2500 Discord servers) and
containerized (install all tiers as docker containers, less cluttered, discord shards auto-scale in case discord enforces sharding due to much usage and can therefore serve an arbitrary number of Discord servers). Kubernetes deployment will come soon.
Run the following command to install on your own infrastructure:
```
wget -O - https://raw.githubusercontent.com/plengauer/philbot/main/INSTALL.sh | sh -E
```

# System Requirements
The bot can run on any debian-based operating system. For hosting a single server, 1 CPU, 1GB RAM, and 4GB disk storage are the absolute minimum (equivalent of an AWS t2.micro). Recommended requirements are 2 CPUs, 2GB RAM, and 4GB disk storage (equivalent of an AWS t3.small). If the bot serves many servers and/or users, requirements may be higher. The recommended requirements can easily host beyond 20 servers or 1500 users.

# Note of the Developers
While this Bot enjoys increased popularity (about 1500 users as of September 2023), it also serves as a learning platform for its developers.
We intentionally choose a new technology for every tier and some aspects are implemented manually even though off-the-shelf packages would be readily available. 
