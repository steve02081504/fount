using System.Diagnostics;
using System.IO;

static class Program
{
	static int Main(string[] args)
	{
		// This runner exists only to make `dotnet run` behave like `./run.sh` / `run.bat`.
		// We delegate execution to the existing launch scripts and pass through arguments.

		var rootDir = Directory.GetCurrentDirectory();

		var psi = new ProcessStartInfo
		{
			WorkingDirectory = rootDir,
			UseShellExecute = false,
		};

		if (OperatingSystem.IsWindows())
		{
			var runBatPath = Path.Combine(rootDir, "run.bat");
			if (!File.Exists(runBatPath))
			{
				Console.Error.WriteLine($"Error: cannot find {runBatPath}");
				return 1;
			}

			psi.FileName = "cmd.exe";
			psi.ArgumentList.Add("/c");
			psi.ArgumentList.Add(runBatPath);
			foreach (var a in args)
			{
				psi.ArgumentList.Add(a);
			}
		}
		else
		{
			var runShPath = Path.Combine(rootDir, "run.sh");
			if (!File.Exists(runShPath))
			{
				Console.Error.WriteLine($"Error: cannot find {runShPath}");
				return 1;
			}

			psi.FileName = "sh";
			psi.ArgumentList.Add(runShPath);
			foreach (var a in args)
			{
				psi.ArgumentList.Add(a);
			}
		}

		var process = Process.Start(psi);
		if (process is null)
		{
			Console.Error.WriteLine("Error: failed to start launch script.");
			return 1;
		}

		process.WaitForExit();
		return process.ExitCode;
	}
}

