FROM node:18
WORKDIR /application

RUN apt-get update && apt-get -y install ffmpeg

ENV MEMORY_DIRECTORY=/memory
RUN mkdir $MEMORY_DIRECTORY

COPY package.json ./
RUN npm install
COPY . .

ENV SERVICE_NAME="Philbot Backend"
ENV SERVICE_VERSION=""
CMD exec npm start

EXPOSE 443
EXPOSE 8080
