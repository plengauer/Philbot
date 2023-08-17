FROM node:18
WORKDIR /application

RUN apt-get update && apt-get -y install ffmpeg

ENV MEMORY_DIRECTORY=/memory
RUN mkdir $MEMORY_DIRECTORY

COPY package.json ./
RUN npm install
COPY . .

ENV PORT=8080

ENV SERVICE_NAME="Philbot Backend"
ENV SERVICE_VERSION=""
# can't use exec to save a process, see https://github.com/nodejs/node-v0.x-archive/issues/9131
CMD node backend.js

EXPOSE 8080
