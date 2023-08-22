ThisBuild / version := "0.1.0-SNAPSHOT"

ThisBuild / scalaVersion := "2.13.11"

libraryDependencies += "com.typesafe.akka" %% "akka-http" % "10.5.0"
libraryDependencies += "com.typesafe.akka" %% "akka-http-spray-json" % "10.5.0"
libraryDependencies += "com.typesafe.akka" %% "akka-stream" % "2.7.0"

lazy val root = (project in file("."))
  .settings(
    name := "Shards",
    idePackagePrefix := Some("eu.philbot")
  )
