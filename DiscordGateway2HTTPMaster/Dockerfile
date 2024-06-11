FROM maven:3.9.7-eclipse-temurin-21-jammy AS build
WORKDIR /build
COPY pom.xml ./
COPY src ./src
RUN mvn clean package -DskipTests

FROM amazoncorretto:21.0.3
WORKDIR /application
COPY --from=build /build/target/DiscordGateway2HTTPMaster-1.0-SNAPSHOT.jar DiscordGateway2HTTPMaster.jar
RUN curl -L https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v1.38.0/opentelemetry-javaagent.jar --output opentelemetry-javaagent.jar
COPY VERSION run.sh ./
ENV PORT=8080
CMD exec sh run.sh
EXPOSE 8080/tcp
