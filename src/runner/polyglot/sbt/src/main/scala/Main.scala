object Main {
	def main(args: Array[String]): Unit = {
		val isWindows = System.getProperty("os.name").toLowerCase.contains("windows")

		val scriptName = if (isWindows) "run.bat" else "run.sh"
		val scriptDir = {
			val location = getClass.getProtectionDomain.getCodeSource.getLocation
			val codePath = new java.io.File(location.toURI).getAbsoluteFile
			val startDir = if (codePath.isFile) codePath.getParentFile else codePath

			// Walk up from class/jar location so we can set the correct working directory
			// (and avoid relying on the JVM current working directory).
			val maybeDir = Iterator
				.iterate(startDir)(_.getParentFile)
				.take(16)
				.filter(_ != null)
				.find(d => new java.io.File(d, scriptName).exists())

			maybeDir.getOrElse(new java.io.File(System.getProperty("user.dir")))
		}

		val cmd: Seq[String] =
			if (isWindows) Seq("cmd.exe", "/c", "run.bat") ++ args
			else Seq("sh", "run.sh") ++ args

		val exitCode =
			new ProcessBuilder(cmd: _*)
				.directory(scriptDir)
				.inheritIO()
				.start()
				.waitFor()
		sys.exit(exitCode)
	}
}

