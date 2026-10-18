; Extra install steps layered on Tauri's NSIS installer.

!macro NSIS_HOOK_POSTINSTALL
  ; Buzzer USB driver. Skipped for in-app updates so they never pop an admin
  ; prompt; the script itself also skips if the driver is already installed.
  ${If} $UpdateMode <> 1
    DetailPrint "Installing CP210x buzzer USB driver..."
    nsExec::Exec 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\drivers\install-cp210x.ps1"'
  ${EndIf}

  CreateShortCut "$SMPROGRAMS\Lucky Draw - Flash Buzzer.lnk" "$INSTDIR\tools\Flash Buzzer.exe"
  CreateShortCut "$SMPROGRAMS\Lucky Draw - CSV Templates.lnk" "$INSTDIR\templates"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$SMPROGRAMS\Lucky Draw - Flash Buzzer.lnk"
  Delete "$SMPROGRAMS\Lucky Draw - CSV Templates.lnk"
!macroend
