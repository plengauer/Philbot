FROM ubuntu:rolling AS downloader
WORKDIR /downloads
RUN apt-get update && apt-get install -y wget
# this is super anti-pattern, fix with a proper maven project
RUN wget https://repo1.maven.org/maven2/io/opentelemetry/opentelemetry-api/1.29.0/opentelemetry-api-1.29.0.jar
RUN wget https://repo1.maven.org/maven2/io/opentelemetry/opentelemetry-context/1.9.1/opentelemetry-context-1.9.1.jar
RUN wget https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar
RUN wget https://repo1.maven.org/maven2/io/opentelemetry/contrib/opentelemetry-aws-resources/1.29.0-alpha/opentelemetry-aws-resources-1.29.0-alpha.jar


# FROM amazoncorretto:20
FROM eclipse-temurin:latest
SHELL ["/bin/bash", "-c"]
WORKDIR /application

COPY --from=downloader /downloads/ ./
COPY run.sh version.txt logging.properties src/ ./
RUN javac -cp $(find . -name '*.jar' | paste -sd ":" -) eu/philbot/*.java && rm eu/philbot/*.java

ENV PORT=8080

CMD exec sh run.sh

EXPOSE 8080/tcp
