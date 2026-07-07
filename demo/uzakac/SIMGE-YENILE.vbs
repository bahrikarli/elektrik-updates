' Simge ve kisayolu sifirdan yeniler (CMD hatasi olmaz).
Dim sh, fso, klasor, ps1, psExe, cmd
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
klasor = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = klasor & "\kisayol-olustur.ps1"

If Not fso.FileExists(ps1) Then
  MsgBox "kisayol-olustur.ps1 bulunamadi." & vbCrLf & klasor, vbCritical, "ELEKTRIK"
  WScript.Quit 1
End If

psExe = sh.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
If Not fso.FileExists(psExe) Then psExe = "powershell.exe"

cmd = """" & psExe & """ -NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """"
sh.Run cmd, 1, True

MsgBox "Tamam." & vbCrLf & vbCrLf & "Masaustundeki eski ELEKTRIK kisayolunu silin." & vbCrLf & "Yeni simge gorunmezse PC'yi bir kez yeniden baslatin.", vbInformation, "ELEKTRIK"
