use std::process::Command;

#[tauri::command]
pub fn inject_android_touch(
    serial: Option<String>,
    action: String,
    x: i32,
    y: i32,
    to_x: Option<i32>,
    to_y: Option<i32>,
    duration_ms: Option<u32>,
) -> Result<(), String> {
    let mut args: Vec<String> = Vec::new();
    if let Some(dev) = serial {
        if !dev.trim().is_empty() {
            args.push("-s".to_string());
            args.push(dev);
        }
    }

    args.push("shell".to_string());
    args.push("input".to_string());

    match action.as_str() {
        "tap" | "down" => {
            args.push("tap".to_string());
            args.push(x.to_string());
            args.push(y.to_string());
        }
        "swipe" | "move" => {
            let end_x = to_x.unwrap_or(x);
            let end_y = to_y.unwrap_or(y);
            let dur = duration_ms.unwrap_or(140);
            args.push("swipe".to_string());
            args.push(x.to_string());
            args.push(y.to_string());
            args.push(end_x.to_string());
            args.push(end_y.to_string());
            args.push(dur.to_string());
        }
        "up" => {
            return Ok(());
        }
        _ => return Err(format!("Unsupported touch action: {}", action)),
    }

    let output = Command::new("adb")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run adb: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("adb input error: {}", stderr));
    }

    Ok(())
}
