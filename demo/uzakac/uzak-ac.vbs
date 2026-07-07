' Uzak-Ac.bat — CMD penceresi acmadan sunucuya baglanir.
Dim sh, fso, klasor, bat
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
klasor = fso.GetParentFolderName(WScript.ScriptFullName)
bat = klasor & "\Uzak-Ac.bat"

If Not fso.FileExists(bat) Then
  MsgBox "Uzak-Ac.bat bulunamadi." & vbCrLf & klasor, vbCritical, "ELEKTRIK"
  WScript.Quit 1
End If

sh.Run """" & bat & """", 0, False
