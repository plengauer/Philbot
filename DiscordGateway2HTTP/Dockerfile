FROM node:18
WORKDIR /application

COPY package.json ./
RUN npm install
COPY . .

ENV SHARD_INDEX=0
ENV SHARD_COUNT=1
ENV PORT=8080

ENV SERVICE_NAME="Philbot Discord Gateway 2 HTTP"
ENV SERVICE_VERSION=""
# can't use exec to save a process, see https://github.com/nodejs/node-v0.x-archive/issues/9131
CMD node discordgateway2http.js

EXPOSE 8080
