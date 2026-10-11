; The app was called "Image Library" before it became Stockroom. A new product
; name installs into a folder of its own and adds its own entry to the
; installed apps, so the old app is uninstalled first. Its uninstaller keeps
; the settings (it removes them only when that is ticked in its own window);
; Stockroom moves them to its folders on the first launch (src/appdirs.rs).
!macro NSIS_HOOK_PREINSTALL
  Push $R0
  Push $R1
  ReadRegStr $R0 SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\Image Library" "UninstallString"
  ReadRegStr $R1 SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\Image Library" "InstallLocation"
  ${If} $R0 != ""
    ${If} $R1 == ""
      ExecWait '$R0 /S'
    ${Else}
      ; InstallLocation is in quotes.
      StrCpy $R1 $R1 -1 1
      ; Run from its folder rather than a temporary copy, so this waits for
      ; it; it can't delete itself then.
      ExecWait '$R0 /S _?=$R1'
      Delete "$R1\uninstall.exe"
      RMDir "$R1"
    ${EndIf}
  ${EndIf}
  Pop $R1
  Pop $R0
!macroend
