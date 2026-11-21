export type ModifierKey = "Ctrl" | "Shift" | "Alt";

export type ControlKind =
  | "tap"
  | "joystick"
  | "aim_pan"
  | "macro"
  | "free_mouse";

export type TriggerBehavior = "Tap" | "Hold" | "Repeat" | "Toggle";

export type PressedBySource = "Key" | "MMB";

export type MacroStep =
  | { id: string; type: "tap"; xNorm: number; yNorm: number; durationMs?: number }
  | {
      id: string;
      type: "swipe";
      fromXNorm: number;
      fromYNorm: number;
      toXNorm: number;
      toYNorm: number;
      durationMs: number;
    }
  | { id: string; type: "wait"; durationMs: number }
  | { id: string; type: "key"; key: string; modifiers?: ModifierKey[] }
  | { id: string; type: "toggle_mouse"; mode?: "free" | "aim" | "toggle" };

export interface KeyBinding {
  key: string;
  modifiers: ModifierKey[];
}

export interface MappedControl {
  id: string;
  label: string;
  kind: ControlKind;
  binding: KeyBinding;
  xNorm: number;
  yNorm: number;
  radiusNorm?: number;
  runReachNorm?: number;
  runKey?: string;
  scale?: number;
  fade?: number; // 0.1 - 1.0 (di UI tampil sebagai 10% - 100%)
  sensitivity?: number;
  behavior?: TriggerBehavior;
  opensMenu?: boolean;
  whenHeld?: boolean;
  pressedBy?: PressedBySource;
  mouseDragsWhileHeld?: boolean;
  wasdKeys?: {
    up: string;
    down: string;
    left: string;
    right: string;
  };
  macro?: {
    primarySteps: MacroStep[];
    secondarySteps?: MacroStep[];
    nextToggleIndex: 0 | 1;
  };
}

export interface GameLayout {
  id: string;
  number: number;
  name: string;
  freeMouseKey: string;
  controls: MappedControl[];
}

export interface TouchDispatchPayload {
  action: "down" | "up" | "move" | "tap" | "swipe";
  x: number;
  y: number;
  toX?: number;
  toY?: number;
  durationMs?: number;
  pointerId?: number;
}

export interface JoystickVector {
  dx: number;
  dy: number;
}

export interface DeviceResolution {
  width: number;
  height: number;
}

export const KEY_PICKER_GRID: string[][] = [
  ["A", "B", "C", "D", "E", "F"],
  ["G", "H", "I", "J", "K", "L"],
  ["M", "N", "O", "P", "Q", "R"],
  ["S", "T", "U", "V", "W", "X"],
  ["Y", "Z", "0", "1", "2", "3"],
  ["4", "5", "6", "7", "8", "9"],
];

export const KEY_PICKER_SPECIALS: string[] = [
  "SPC",
  "TAB",
  "SHI",
  "CTR",
  "ALT",
  "LMB",
  "RMB",
  "MMB",
  "UP",
  "DOW",
  "LEF",
  "RIG",
  "M4",
  "M5",
  "ESC",
];

export function getBindingSignature(binding: KeyBinding): string {
  const mods = [...new Set(binding.modifiers)].sort();
  return [...mods, binding.key.toUpperCase()].join("+");
}

export function computeWasdVector(
  pressedKeys: Set<string>,
  wasd = { up: "W", down: "S", left: "A", right: "D" }
): JoystickVector {
  let dx = 0;
  let dy = 0;
  if (pressedKeys.has(wasd.left.toUpperCase())) dx -= 1;
  if (pressedKeys.has(wasd.right.toUpperCase())) dx += 1;
  if (pressedKeys.has(wasd.up.toUpperCase())) dy -= 1;
  if (pressedKeys.has(wasd.down.toUpperCase())) dy += 1;

  if (dx !== 0 && dy !== 0) {
    const inv = 1 / Math.SQRT2;
    dx *= inv;
    dy *= inv;
  }
  return { dx, dy };
}

export function joystickToTouchCoords(
  centerX: number,
  centerY: number,
  radiusPx: number,
  vec: JoystickVector
): { x: number; y: number } {
  return {
    x: Math.round(centerX + vec.dx * radiusPx),
    y: Math.round(centerY + vec.dy * radiusPx),
  };
}

export function encodeLayoutShareCode(layout: GameLayout): string {
  const json = JSON.stringify(layout);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `SCRCPY-MAP-V1:${btoa(binary)}`;
}

export function decodeLayoutShareCode(code: string): GameLayout | null {
  try {
    const trimmed = code.trim();
    const rawB64 = trimmed.startsWith("SCRCPY-MAP-V1:")
      ? trimmed.slice("SCRCPY-MAP-V1:".length)
      : trimmed;
    const binary = atob(rawB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as GameLayout;
    if (!parsed || typeof parsed.name !== "string" || !Array.isArray(parsed.controls)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function createDefaultLayouts(): GameLayout[] {
  return [
    {
      id: "layout_1",
      number: 1,
      name: "Layout 1 - mirror",
      freeMouseKey: "Tab",
      controls: [
        {
          id: "ctrl_wasd",
          label: "WASD",
          kind: "joystick",
          binding: { key: "W", modifiers: [] },
          xNorm: 0.21,
          yNorm: 0.68,
          radiusNorm: 0.11,
          runReachNorm: 0.21,
          runKey: "Shift",
          scale: 1,
          fade: 0.9,
          behavior: "Hold",
          pressedBy: "Key",
          wasdKeys: { up: "W", down: "S", left: "A", right: "D" },
        },
        {
          id: "ctrl_q",
          label: "Key Q",
          kind: "tap",
          binding: { key: "Q", modifiers: [] },
          xNorm: 0.31,
          yNorm: 0.27,
          scale: 1,
          fade: 0.85,
          behavior: "Tap",
          pressedBy: "Key",
        },
        {
          id: "ctrl_r",
          label: "Key R",
          kind: "tap",
          binding: { key: "R", modifiers: [] },
          xNorm: 0.63,
          yNorm: 0.44,
          scale: 1,
          fade: 0.85,
          behavior: "Tap",
          pressedBy: "Key",
        },
        {
          id: "ctrl_m4",
          label: "Key M4",
          kind: "tap",
          binding: { key: "M4", modifiers: [] },
          xNorm: 0.72,
          yNorm: 0.47,
          scale: 1,
          fade: 0.85,
          behavior: "Tap",
          pressedBy: "Key",
        },
        {
          id: "ctrl_lmb",
          label: "Key LMB",
          kind: "tap",
          binding: { key: "LMB", modifiers: [] },
          xNorm: 0.79,
          yNorm: 0.29,
          scale: 1,
          fade: 0.85,
          behavior: "Hold",
          pressedBy: "Key",
        },
        {
          id: "ctrl_rmb",
          label: "Key RMB",
          kind: "aim_pan",
          binding: { key: "RMB", modifiers: [] },
          xNorm: 0.8,
          yNorm: 0.49,
          radiusNorm: 0.12,
          sensitivity: 0.0022,
          scale: 1,
          fade: 0.85,
          behavior: "Hold",
          pressedBy: "Key",
          mouseDragsWhileHeld: true,
        },
        {
          id: "ctrl_m5",
          label: "Key M5",
          kind: "tap",
          binding: { key: "M5", modifiers: [] },
          xNorm: 0.91,
          yNorm: 0.21,
          scale: 1,
          fade: 0.85,
          behavior: "Tap",
          pressedBy: "Key",
        },
        {
          id: "ctrl_spc",
          label: "Key SPC",
          kind: "tap",
          binding: { key: "SPC", modifiers: [] },
          xNorm: 0.91,
          yNorm: 0.46,
          scale: 1,
          fade: 0.85,
          behavior: "Tap",
          pressedBy: "Key",
        },
        {
          id: "ctrl_ctr",
          label: "Key CTR",
          kind: "tap",
          binding: { key: "CTR", modifiers: [] },
          xNorm: 0.91,
          yNorm: 0.85,
          scale: 1,
          fade: 0.85,
          behavior: "Toggle",
          pressedBy: "Key",
        },
        {
          id: "ctrl_tab",
          label: "Key TAB",
          kind: "free_mouse",
          binding: { key: "TAB", modifiers: [] },
          xNorm: 0.78,
          yNorm: 0.88,
          scale: 1,
          fade: 0.85,
          behavior: "Toggle",
          opensMenu: true,
          pressedBy: "Key",
        },
      ],
    },
  ];
}
