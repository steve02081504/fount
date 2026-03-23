ThisBuild / organization := "com.steve02081504"
ThisBuild / version := "0.0.0"
ThisBuild / scalaVersion := "2.13.14"
ThisBuild / name := "fount-sbt-runner"

Compile / run / mainClass := Some("Main")

// Move the runner sources under src/runner/ to avoid polluting the root layout.
Compile / unmanagedSourceDirectories := Seq(
	(baseDirectory.value / "src/runner/polyglot/sbt/src/main/scala")
)
