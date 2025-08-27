$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:8930/")
$listener.Start()

try {
	while ($true) {
		$response = $listener.GetContext().Response
		$response.AddHeader("Access-Control-Allow-Origin", "*")
		$buffer = [System.Text.Encoding]::UTF8.GetBytes('{"message":"pong"}')
		$response.ContentType = "application/json"
		$response.ContentLength64 = $buffer.Length
		$response.OutputStream.Write($buffer, 0, $buffer.Length)
		$response.Close()
	}
}
finally {
	$listener.Stop()
	$listener.Close()
}
