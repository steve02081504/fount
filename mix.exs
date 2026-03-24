defmodule Fount.MixProject do
	use Mix.Project

	def project do
		[
			app: :fount,
			version: "0.1.0",
			elixir: "~> 1.16",
			start_permanent: Mix.env() == :prod,
			elixirc_paths: ["src/runner/polyglot/mix/lib"],
			deps: []
		]
	end

	def application do
		[
			extra_applications: [:logger],
			mod: {Fount, []}
		]
	end
end
