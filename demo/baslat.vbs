' BASLAT.bat — siyah CMD acmadan PowerShell baslatir.
Dim sh, fso, demo, ps1, psExe, cmd
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
demo = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = demo & "\baslat-arkaplan.ps1"

If Not fso.FileExists(ps1) Then
  MsgBox "baslat-arkaplan.ps1 bulunamadi." & vbCrLf & demo, vbCritical, "Elektrik Otomasyon"
  WScript.Quit 1
End If

psExe = sh.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
If Not fso.FileExists(psExe) Then
  psExe = "powershell.exe"
End If

cmd = """" & psExe & """ -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """"
sh.Run cmd, 0, False
