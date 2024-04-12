FROM node:21.7.3
WORKDIR /application

COPY package.json ./
RUN npm install
COPY . .

ENV SHARD_INDEX=auto
ENV SHARD_COUNT=auto
ENV PORT=8080

CMD exec node discordgateway2http.js

EXPOSE 8080
