FROM node:latest
ARG APPLICATION_VERSION
WORKDIR /application

RUN apt-get update && apt-get -y install ffmpeg

ENV MEMORY_DIRECTORY=/memory
RUN mkdir $MEMORY_DIRECTORY

COPY package.json ./
RUN npm install
COPY . .

ENV PORT=8080

ENV SERVICE_NAME="Philbot Backend"
ENV SERVICE_VERSION=$APPLICATION_VERSION
CMD exec node backend.js

EXPOSE 8080
