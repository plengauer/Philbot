export $(cat environment.properties | xargs) &&
node backend.js
