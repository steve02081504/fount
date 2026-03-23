defmodule Fount do
	use Application

	@impl true
	def start(_type, _args) do
		# One-shot runner: when `run.sh`/`run.bat` finishes, this linked task ends
		# and the application should exit as well.
		{:ok, pid} =
			Task.start_link(fn ->
				argv = System.argv()

				case :os.type() do
					{:win32, _} ->
						{_output, status} =
							System.cmd("cmd.exe", ["/c", "run.bat" | argv], into: IO.stream(:stdio, :line))

						System.halt(status)
					_ ->
						{_output, status} =
							System.cmd("sh", ["run.sh" | argv], into: IO.stream(:stdio, :line))

						System.halt(status)
				end
			end)

		{:ok, pid}
	end
end

