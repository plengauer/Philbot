FROM node:22.14.0
WORKDIR /application

RUN apt-get update && apt-get -y install ffmpeg

COPY package.json ./
RUN npm install
COPY . .

ENV MEMORY_DIRECTORY=/memory
RUN mkdir $MEMORY_DIRECTORY

ENV PORT=8080

CMD exec node backend.js

EXPOSE 8080
