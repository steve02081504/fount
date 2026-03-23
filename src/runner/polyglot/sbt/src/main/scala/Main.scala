object Main {
	def main(args: Array[String]): Unit = {
		val isWindows = System.getProperty("os.name").toLowerCase.contains("windows")

		val cmd: Seq[String] =
			if (isWindows) Seq("cmd.exe", "/c", "run.bat") ++ args
			else Seq("sh", "run.sh") ++ args

		val exitCode = new ProcessBuilder(cmd: _*).inheritIO().start().waitFor()
		sys.exit(exitCode)
	}
}

