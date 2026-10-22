; Extra install steps layered on Tauri's NSIS installer.

!macro NSIS_HOOK_POSTINSTALL
  ; Buzzer USB driver. Skipped for in-app updates so they never pop an admin
  ; prompt, and skipped when the driver is already in the Windows driver store.
  ; Runs pnputil directly (no PowerShell, which antivirus treats as suspicious).
  ; The installer is 32-bit, so Sysnative reaches the real 64-bit System32.
  ${If} $UpdateMode <> 1
    FindFirst $0 $1 "$WINDIR\Sysnative\DriverStore\FileRepository\silabser.inf_*"
    FindClose $0
    ${If} $1 == ""
      DetailPrint "Installing CP210x buzzer USB driver..."
      ExecShellWait "runas" "$WINDIR\Sysnative\pnputil.exe" '/add-driver "$INSTDIR\drivers\cp210x\silabser.inf" /install' SW_HIDE
    ${EndIf}
  ${EndIf}

  CreateShortCut "$SMPROGRAMS\Lucky Draw - Flash Buzzer.lnk" "$INSTDIR\tools\Flash Buzzer.exe"
  CreateShortCut "$SMPROGRAMS\Lucky Draw - CSV Templates.lnk" "$INSTDIR\templates"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$SMPROGRAMS\Lucky Draw - Flash Buzzer.lnk"
  Delete "$SMPROGRAMS\Lucky Draw - CSV Templates.lnk"
!macroend
