FROM python:latest
ARG APPLICATION_VERSION
SHELL ["/bin/bash", "-c"]
WORKDIR /application

RUN apt-get -y update && apt-get -y install ffmpeg
RUN apt-get -y install libopusfile0 && wget -O libopus.tar.bz2 https://anaconda.org/anaconda/libopus/1.3/download/linux-64/libopus-1.3-h7b6447c_0.tar.bz2 && tar -xf libopus.tar.bz2 -C . && rm libopus.tar.bz2
ENV LD_LIBRARY_PATH=./lib/

ENV STORAGE_DIRECTORY=/audio_cache
RUN mkdir $STORAGE_DIRECTORY

COPY pyproject.toml ./
RUN python -m venv venv-build && source venv-build/bin/activate && pip install poetry && poetry export -f requirements.txt --output requirements.txt && deactivate && rm -rf venv-build *.toml

RUN pip install --no-cache-dir -r requirements.txt
COPY philbot-voice/* ./

ENV PORT=8080

ENV SERVICE_NAME="Philbot Voice"
ENV SERVICE_VERSION=$APPLICATION_VERSION
CMD exec opentelemetry-instrument python -u voice.py

EXPOSE 8080/tcp
EXPOSE 1-65535/udp
