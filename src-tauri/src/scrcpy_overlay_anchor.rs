use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct ScrcpyWindowRect {
    pub found: bool,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[cfg(target_os = "windows")]
mod win_anchor {
    use super::ScrcpyWindowRect;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible,
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_SHOWWINDOW,
    };

    struct SearchTarget {
        needle: String,
        rect: Option<RECT>,
    }

    unsafe extern "system" fn enum_scrcpy_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let target = &mut *(lparam as *mut SearchTarget);
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }

        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return 1;
        }

        let mut buf: Vec<u16> = vec![0; (len + 1) as usize];
        let copied = GetWindowTextW(hwnd, buf.as_mut_ptr(), len + 1);
        if copied <= 0 {
            return 1;
        }

        let title = OsString::from_wide(&buf[..copied as usize])
            .to_string_lossy()
            .to_lowercase();

        if title.contains("scrcpy") && (target.needle.is_empty() || title.contains(&target.needle)) {
            let mut r: RECT = std::mem::zeroed();
            if GetWindowRect(hwnd, &mut r) != 0 && (r.right - r.left) > 50 && (r.bottom - r.top) > 50 {
                target.rect = Some(r);
                return 0;
            }
        }
        1
    }

    pub fn find_scrcpy_rect(serial: Option<String>) -> ScrcpyWindowRect {
        let needle = serial.unwrap_or_default().trim().to_lowercase();
        let mut target = SearchTarget { needle, rect: None };

        unsafe {
            EnumWindows(Some(enum_scrcpy_proc), &mut target as *mut SearchTarget as LPARAM);
        }

        if let Some(r) = target.rect {
            ScrcpyWindowRect {
                found: true,
                x: r.left,
                y: r.top,
                width: (r.right - r.left).max(1),
                height: (r.bottom - r.top).max(1),
            }
        } else {
            ScrcpyWindowRect {
                found: false,
                x: 0,
                y: 0,
                width: 0,
                height: 0,
            }
        }
    }

    pub fn position_overlay_hwnd(hwnd: HWND, x: i32, y: i32, width: i32, height: i32) {
        unsafe {
            SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                x,
                y,
                width,
                height,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
        }
    }
}

#[tauri::command]
pub fn get_scrcpy_window_rect(serial: Option<String>) -> ScrcpyWindowRect {
    #[cfg(target_os = "windows")]
    {
        win_anchor::find_scrcpy_rect(serial)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = serial;
        ScrcpyWindowRect {
            found: false,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        }
    }
}

#[tauri::command]
pub fn sync_overlay_to_scrcpy(
    window: tauri::Window,
    serial: Option<String>,
) -> Result<ScrcpyWindowRect, String> {
    #[cfg(target_os = "windows")]
    {
        let rect = win_anchor::find_scrcpy_rect(serial);
        if rect.found {
            if let Ok(hwnd) = window.hwnd() {
                win_anchor::position_overlay_hwnd(
                    hwnd.0 as windows_sys::Win32::Foundation::HWND,
                    rect.x,
                    rect.y,
                    rect.width,
                    rect.height,
                );
            }
        }
        Ok(rect)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, serial);
        Ok(ScrcpyWindowRect {
            found: false,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        })
    }
}
