sudo service philbot_backend stop
sudo service philbot_discordgateway2http stop
sudo service philbot_scheduler stop

sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080 &&
curl -fsSL https://deb.nodesource.com/setup_19.x | sudo -E bash - &&
sudo apt-get -y install nodejs ruby &&

mkdir -p memory &&
mkdir -p backend &&
mkdir -p discordgateway2http &&
mkdir -p scheduler &&

cp -f -T environment.properties.backend ./backend/environment.properties &&
cp -f -T environment.properties.discordgateway2http ./discordgateway2http/environment.properties &&
cp -f -T environment.properties.scheduler ./scheduler/environment.properties &&
cp -f -T config.properties.scheduler ./scheduler/config.properties &&

echo MEMORY_DIRECTORY=$(pwd)/memory/ >> ./backend/environment.properties &&
echo CONFIG_FILE=$(pwd)/scheduler/config.properties >> ./scheduler/environment.properties &&

cat nodejs.service.template | sed 's~$directory~'$(pwd)'\/backend~g' | sed 's/$package/philbot-backend/g' > philbot_backend.service &&
cat nodejs.service.template | sed 's~$directory~'$(pwd)'\/discordgateway2http~g' | sed 's/$package/philbot-discordgateway2http/g' > philbot_discordgateway2http.service &&
cat ruby.service.template | sed 's~$directory~'$(pwd)'\/scheduler~g' | sed 's/$gem/philbot-scheduler/g' > philbot_scheduler.service &&

sudo mv *.service /etc/systemd/system/ &&
sudo systemctl daemon-reload &&
sudo service philbot_backend start &&
sudo service philbot_discordgateway2http start &&
sudo service philbot_scheduler start &&

exit 0

