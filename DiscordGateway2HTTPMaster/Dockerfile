FROM ubuntu:rolling AS downloader
WORKDIR /downloads
RUN apt-get update && apt-get install -y wget xpath
# this is super anti-pattern, fix with a proper maven project
COPY pom.xml ./
# TODO iterate thoiugh the pom and install all
# TODO also parse the verison and put it in file
# TODO also adjust the github publish image to read the version from the new file
# TODO also teach auto-version pom.xml files
RUN wget https://repo1.maven.org/maven2/io/opentelemetry/opentelemetry-api/1.41.0/opentelemetry-api-1.41.0.jar
RUN wget https://repo1.maven.org/maven2/io/opentelemetry/opentelemetry-context/1.41.0/opentelemetry-context-1.41.0.jar
RUN wget https://repo1.maven.org/maven2/io/opentelemetry/contrib/opentelemetry-aws-resources/1.38.0-alpha/opentelemetry-aws-resources-1.38.0-alpha.jar
RUN wget -O opentelemetry-javaagent.jar https://repo1.maven.org/maven2/io/opentelemetry/javaagent/opentelemetry-javaagent/1.33.6/opentelemetry-javaagent-1.33.6.jar

FROM amazoncorretto:21.0.4
SHELL ["/bin/bash", "-c"]
WORKDIR /application

COPY --from=downloader /downloads/ ./
COPY run.sh logging.properties src/ ./
RUN javac -cp $(find . -name '*.jar' | paste -sd ":" -) eu/philbot/*.java && rm eu/philbot/*.java

ENV PORT=8080

CMD exec sh run.sh

EXPOSE 8080/tcp
