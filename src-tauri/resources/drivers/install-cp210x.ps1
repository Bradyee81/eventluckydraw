# Installs the Silicon Labs CP210x USB driver the buzzer's ESP32 board uses,
# so Config > Buzzer Setup and the flash tool can see it over USB.
# Run by the installer after install; asks for admin only if the driver is missing.

$inf = Join-Path $PSScriptRoot 'cp210x\silabser.inf'

$installed = pnputil /enum-drivers | Select-String -SimpleMatch 'silabser.inf'
if ($installed) { exit 0 }

try {
    Start-Process pnputil -ArgumentList '/add-driver', "`"$inf`"", '/install' -Verb RunAs -Wait -WindowStyle Hidden
} catch {
    # User declined the admin prompt — the app still works, just not over USB.
    exit 0
}
