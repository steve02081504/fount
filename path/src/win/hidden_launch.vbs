' Hidden-launch helper shared by the path CLI and the server (src/scripts/launch_external.mjs).
' wscript.exe is a GUI-subsystem host: it never allocates a console, so nothing flashes or lingers.
' Invocation: wscript //nologo "<this>" <base64-cmdline> [suffix]
'   - decode and run hidden (window style 0), no wait
'   - suffix: optional argument appended to the decoded command (quoted)
Function DecodeB64(ByVal s)
	Dim xmlDoc, bnode, bytes, st
	Set xmlDoc = CreateObject("MSXML2.DOMDocument.6.0")
	Set bnode = xmlDoc.createElement("b64")
	bnode.dataType = "bin.base64"
	bnode.text = s
	bytes = bnode.nodeTypedValue
	Set st = CreateObject("ADODB.Stream")
	st.Type = 1
	st.Open
	st.Write bytes
	st.Position = 0
	st.Type = 2
	st.Charset = "utf-8"
	DecodeB64 = st.ReadText
	st.Close
End Function

Set sh = WScript.CreateObject("WScript.Shell")
If WScript.Arguments.Count = 0 Then
	WScript.Quit 1
End If
Dim cmd
cmd = DecodeB64(WScript.Arguments(0))
If WScript.Arguments.Count > 1 Then
	cmd = cmd & " """ & Replace(WScript.Arguments(1), """", """""") & """"
End If
sh.Run cmd, 0, False
