defmodule Fount do
	use Application

	@impl true
	def start(_type, _args) do
		{:ok, pid} =
			Task.start_link(fn ->
				case :os.type() do
					{:win32, _} ->
						System.cmd("cmd.exe", ["/c", "run.bat"], into: IO.stream(:stdio, :line))
					_ ->
						System.cmd("sh", ["run.sh"], into: IO.stream(:stdio, :line))
				end
			end)

		{:ok, pid}
	end
end

