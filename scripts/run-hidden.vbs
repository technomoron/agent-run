Option Explicit
Dim shell, command, argument, i
Set shell = CreateObject("WScript.Shell")
If WScript.Arguments.Count < 1 Then WScript.Quit 2
command = Quote(shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File"
For i = 0 To WScript.Arguments.Count - 1
    argument = WScript.Arguments(i)
    If InStr(argument, Chr(34)) > 0 Then WScript.Quit 2
    command = command & " " & Quote(argument)
Next
WScript.Quit shell.Run(command, 0, True)

Function Quote(value)
    Quote = Chr(34) & value & Chr(34)
End Function
