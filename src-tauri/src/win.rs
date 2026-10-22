// Direct Windows API calls, used instead of PowerShell. Hidden or encoded
// PowerShell is one of the strongest malware signals to antivirus behaviour
// engines (Norton quarantined the app over it), so the app never runs it.

/// IPv4 address of the WiFi adapter that's currently up, if any.
#[cfg(windows)]
pub fn wifi_adapter_ipv4() -> Option<String> {
    adapter_ipv4(windows_sys::Win32::NetworkManagement::IpHelper::IF_TYPE_IEEE80211)
}

/// IPv4 address of the first adapter of this interface type that's up.
#[cfg(windows)]
fn adapter_ipv4(if_type: u32) -> Option<String> {
    use std::net::Ipv4Addr;
    use windows_sys::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, NO_ERROR};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST,
        IP_ADAPTER_ADDRESSES_LH,
    };
    use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows_sys::Win32::Networking::WinSock::{AF_INET, SOCKADDR_IN};

    let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
    let mut size: u32 = 16 * 1024;
    // u64 backing keeps the buffer suitably aligned for the adapter structs.
    let mut buf: Vec<u64> = Vec::new();
    for _ in 0..3 {
        buf = vec![0u64; (size as usize).div_ceil(8)];
        let rc = unsafe {
            GetAdaptersAddresses(
                AF_INET as u32,
                flags,
                std::ptr::null(),
                buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH,
                &mut size,
            )
        };
        match rc {
            NO_ERROR => break,
            ERROR_BUFFER_OVERFLOW => continue, // `size` now holds what's needed
            _ => return None,
        }
    }

    let mut adapter = buf.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
    while !adapter.is_null() {
        let a = unsafe { &*adapter };
        if a.IfType == if_type && a.OperStatus == IfOperStatusUp {
            let mut unicast = a.FirstUnicastAddress;
            while !unicast.is_null() {
                let u = unsafe { &*unicast };
                let sockaddr = u.Address.lpSockaddr;
                if !sockaddr.is_null() && unsafe { (*sockaddr).sa_family } == AF_INET {
                    let sin = unsafe { &*(sockaddr as *const SOCKADDR_IN) };
                    let raw = unsafe { sin.sin_addr.S_un.S_addr };
                    return Some(Ipv4Addr::from(u32::from_be(raw)).to_string());
                }
                unicast = u.Next;
            }
        }
        adapter = a.Next;
    }
    None
}

#[cfg(not(windows))]
pub fn wifi_adapter_ipv4() -> Option<String> {
    None
}

/// Runs `exe params` with the standard Windows admin prompt (no console
/// window) and waits for it. Errors if the prompt is declined.
#[cfg(windows)]
pub fn run_elevated(exe: &str, params: &str) -> Result<u32, String> {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_CANCELLED};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let verb = wide("runas");
    let file = wide(exe);
    let args = wide(params);

    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = args.as_ptr();
    info.nShow = SW_HIDE;

    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        let err = unsafe { GetLastError() };
        return Err(if err == ERROR_CANCELLED {
            "The admin prompt was declined.".to_string()
        } else {
            format!("Couldn't start {exe} (error {err}).")
        });
    }
    if info.hProcess.is_null() {
        return Ok(0);
    }
    let mut code: u32 = 0;
    unsafe {
        WaitForSingleObject(info.hProcess, INFINITE);
        GetExitCodeProcess(info.hProcess, &mut code);
        CloseHandle(info.hProcess);
    }
    Ok(code)
}

#[cfg(not(windows))]
pub fn run_elevated(exe: &str, _params: &str) -> Result<u32, String> {
    Err(format!("{exe} needs Windows"))
}

#[cfg(all(test, windows))]
mod tests {
    use super::adapter_ipv4;

    /// Same lookup as for WiFi, run on wired Ethernet so it can be checked on
    /// machines without WiFi. Prints the address to compare with ipconfig.
    #[test]
    fn reads_an_adapter_address() {
        const IF_TYPE_ETHERNET_CSMACD: u32 = 6;
        println!("ethernet ipv4 = {:?}", adapter_ipv4(IF_TYPE_ETHERNET_CSMACD));
    }
}
