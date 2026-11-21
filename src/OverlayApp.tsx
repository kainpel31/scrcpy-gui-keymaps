import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ScreenOverlayKeymapper } from "./components/ScreenOverlayKeymapper";
import {
  DeviceResolution,
  GameLayout,
  TouchDispatchPayload,
  createDefaultLayouts,
} from "./types/keymap";

interface ScrcpyWindowRect {
  found: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function OverlayApp() {
  const params = new URLSearchParams(window.location.search);
  const serial = params.get("serial");

  const [layouts, setLayouts] = useState<GameLayout[]>(() => {
    try {
      const saved = localStorage.getItem("scrcpy_gui_visual_layouts_v1");
      if (saved) {
        const parsed = JSON.parse(saved) as GameLayout[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // fallback to default
    }
    return createDefaultLayouts();
  });

  const [activeLayoutId, setActiveLayoutId] = useState<string>(
    () => layouts[0]?.id ?? "layout_1"
  );

  const [deviceResolution, setDeviceResolution] = useState<DeviceResolution>({
    width: 1920,
    height: 1080,
  });

  useEffect(() => {
    if (!serial) return;
    invoke<DeviceResolution>("get_device_resolution", {
      serial,
      customPath: null,
    })
      .then((res) => {
        if (res && res.width > 0 && res.height > 0) {
          setDeviceResolution({ width: res.width, height: res.height });
        }
      })
      .catch(() => {});
  }, [serial]);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      if (cancelled) return;
      try {
        await invoke<ScrcpyWindowRect>("sync_overlay_to_scrcpy", {
          serial: serial ?? null,
        });
      } catch {
        // ignore if scrcpy window not found yet
      }
    };

    void sync();
    const timer = setInterval(() => {
      void sync();
    }, 100);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [serial]);

  const handleDispatchTouch = async (payload: TouchDispatchPayload) => {
    try {
      await invoke("inject_android_touch", {
        serial: serial ?? null,
        customPath: null,
        action: payload.action,
        x: payload.x,
        y: payload.y,
        toX: payload.toX ?? null,
        toY: payload.toY ?? null,
        durationMs: payload.durationMs ?? null,
      });
    } catch (e) {
      console.error("Failed to inject touch:", e);
    }
  };

  const handleCloseOverlayWindow = async () => {
    try {
      await getCurrentWindow().close();
    } catch {
      window.close();
    }
  };

  return (
    <ScreenOverlayKeymapper
      activeDevice={serial}
      layouts={layouts}
      activeLayoutId={activeLayoutId}
      deviceWidth={deviceResolution.width}
      deviceHeight={deviceResolution.height}
      onSelectLayout={setActiveLayoutId}
      onChangeLayouts={setLayouts}
      onDispatchTouch={handleDispatchTouch}
      onCloseOverlay={() => void handleCloseOverlayWindow()}
    />
  );
}

export default OverlayApp;
