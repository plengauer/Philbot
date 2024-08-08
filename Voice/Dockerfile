FROM python:latest AS extractor
WORKDIR /extractions
COPY pyproject.toml ./
RUN pip install poetry && poetry export -f requirements.txt --output requirements.txt
RUN cat pyproject.toml | grep version | grep -E '[0-9]+\.[0-9]+\.[0-9]+' -o > version.txt


FROM ubuntu:rolling AS downloader
WORKDIR /downloads
RUN apt-get update && apt-get install -y wget curl tar bzip2
# RUN wget -O libopus.tar.bz2 https://anaconda.org/anaconda/libopus/1.3/download/linux-64/libopus-1.3-h7b6447c_0.tar.bz2 && tar -xf libopus.tar.bz2 -C . && rm libopus.tar.bz2
RUN curl -v --fail -L https://anaconda.org/anaconda/libopus/1.3/download/linux-64/libopus-1.3-h7b6447c_0.tar.bz2 > libopus.tar.bz2 && tar -xf libopus.tar.bz2 -C . && rm libopus.tar.bz2


FROM python:3.12.5
SHELL ["/bin/bash", "-c"]
WORKDIR /application

RUN apt-get -y update && apt-get -y install ffmpeg libopusfile0

COPY --from=downloader /downloads/ ./
ENV LD_LIBRARY_PATH=./lib/

COPY --from=extractor /extractions/requirements.txt /extractions/version.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY philbot-voice/* ./

ENV STORAGE_DIRECTORY=/audio_cache
RUN mkdir $STORAGE_DIRECTORY

ENV PORT=8080

CMD exec opentelemetry-instrument python -u voice.py

EXPOSE 8080/tcp
EXPOSE 1-65535/udp
