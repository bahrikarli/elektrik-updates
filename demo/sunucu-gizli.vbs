' Elektrik-Otomasyon.exe — konsol penceresi gostermeden baslatir.
Option Explicit
Dim sh, fso, demo, exe
Set fso = CreateObject("Scripting.FileSystemObject")
demo = fso.GetParentFolderName(WScript.ScriptFullName)
exe = demo & "\Elektrik-Otomasyon.exe"
If Not fso.FileExists(exe) Then WScript.Quit 1

Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = demo
sh.Environment("Process").Item("OPEN_BROWSER") = "0"
sh.Environment("Process").Item("OPEN_APP") = "1"
sh.Run Chr(34) & exe & Chr(34), 0, False
