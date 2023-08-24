FROM hseeberger/scala-sbt:11.0.6_1.3.10_2.13.1 as build
WORKDIR /application
COPY . /application
RUN sbt clean compile stage

FROM eclipse-temurin:latest
WORKDIR /application
COPY --from=build /application/target/universal/stage /application/

CMD exec /application/bin/ShardsMaster
