export $(cat environment.properties | xargs) &&
node discordgateway2http.js
