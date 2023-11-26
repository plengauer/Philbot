This is Philbot, a Discord Bot. Among other things, it can play music, give real-time hints for games, organize group events, and is fully AI powered. See all features here: http://philbot.eu/help. Add it to your own Discord server with this link: http://philbot.eu/deploy. It is SaaS hosted and free.

To deploy and host it on your own infrastructure, select one the deb packages from this repostory `http://philbot.eu:8000/`.
The deployment packages ONLY take care of deployment, the Bot itself will auto-update.
Currently, there are two deployment models supported:
baremetal (install all dependencies on the system, slightly reduced downtime when auto-updating, enables fine-grained control over individual services, ideal to get to know it and to experiment) and
containerized (install all tiers as docker containers, less cluttered, discord shards manually scalable in case discord enforces sharding due to much usage). Kubernetes deployment will come soon.
Run the following command to install on your own infrastructure:
```
wget -O - https://raw.githubusercontent.com/plengauer/philbot/main/INSTALL.sh | sh -E
```

While this Bot enjoys increased popularity (about 1500 users as of September 2023), it also serves as a learning platform for its developers.
We intentionally choose a new technology for every tier and some aspects are implemented manually even though off-the-shelf packages would be readily available. 
