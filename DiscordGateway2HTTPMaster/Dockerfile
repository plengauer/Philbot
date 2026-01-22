FROM ubuntu:rolling AS downloader
WORKDIR /downloads
RUN apt-get update && apt-get install -y wget && snap install yq
# this is super anti-pattern, fix with a proper maven project
# EDIT: this is still an anti-pattern. but now renovate can handle it
COPY pom.xml ./
RUN yq -p=xml -o=json pom.xml | jq -r .project.version > VERSION
RUN yq -p=xml -o=json pom.xml | jq -r .project.dependencies.dependency[].artifactId | while read -r artifactId; do groupId="$(yq -p=xml -o=json pom.xml | jq -r '.project.dependencies.dependency[] | select(.artifactId == "'$artifactId'") | .groupId' | tr . /)"; version="$(yq -p=xml -o=js
on pom.xml | jq -r '.project.dependencies.dependency[] | select(.artifactId == "'$artifactId'") | .version')"; echo "https://repo1.maven.org/maven2/$groupId/$artifactId/$version/$artifactId-$version.jar"; done | xargs wget

FROM amazoncorretto:25.0.2
SHELL ["/bin/bash", "-c"]
WORKDIR /application

COPY --from=downloader /downloads/ ./
COPY run.sh logging.properties src/ ./
RUN javac -cp $(find . -name '*.jar' | paste -sd ":" -) eu/philbot/*.java && rm eu/philbot/*.java

ENV PORT=8080

CMD exec sh run.sh

EXPOSE 8080/tcp
