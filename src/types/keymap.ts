export type ModifierKey = 'Ctrl' | 'Shift' | 'Alt';

export type ControlKind =
  | 'tap'
  | 'joystick'
  | 'aim_pan'
  | 'macro'
  | 'free_mouse';

export type MacroStep =
  | { id: string; type: 'tap'; xNorm: number; yNorm: number; durationMs?: number }
  | {
      id: string;
      type: 'swipe';
      fromXNorm: number;
      fromYNorm: number;
      toXNorm: number;
      toYNorm: number;
      durationMs: number;
    }
  | { id: string; type: 'wait'; durationMs: number }
  | { id: string; type: 'key'; key: string; modifiers?: ModifierKey[] }
  | { id: string; type: 'toggle_mouse'; mode?: 'free' | 'aim' | 'toggle' };

export interface KeyBinding {
  key: string;
  modifiers: ModifierKey[];
}

export interface MappedControl {
  id: string;
  label: string;
  kind: ControlKind;
  binding: KeyBinding;
  xNorm: number; // 0.0 - 1.0
  yNorm: number; // 0.0 - 1.0
  radiusNorm?: number; // radius analog / area gerakan
  sensitivity?: number; // untuk aim_pan
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

export interface KeymapProfile {
  version: 1;
  gameName: string;
  activeLayoutId: string;
  layouts: GameLayout[];
}

export interface TouchDispatchPayload {
  action: 'down' | 'up' | 'move' | 'tap' | 'swipe';
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

export function getBindingSignature(binding: KeyBinding): string {
  const mods = [...new Set(binding.modifiers)].sort();
  return [...mods, binding.key.toUpperCase()].join('+');
}

export function computeWasdVector(
  pressedKeys: Set<string>,
  wasd = { up: 'W', down: 'S', left: 'A', right: 'D' }
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
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `SCRCPY-MAP-V1:${btoa(binary)}`;
}

export function decodeLayoutShareCode(code: string): GameLayout | null {
  try {
    const trimmed = code.trim();
    const rawB64 = trimmed.startsWith('SCRCPY-MAP-V1:')
      ? trimmed.slice('SCRCPY-MAP-V1:'.length)
      : trimmed;
    const binary = atob(rawB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as GameLayout;
    if (!parsed || typeof parsed.name !== 'string' || !Array.isArray(parsed.controls)) {
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
      id: 'layout_1',
      number: 1,
      name: 'On Foot',
      freeMouseKey: 'Tab',
      controls: [
        {
          id: 'ctrl_wasd',
          label: 'Move (WASD)',
          kind: 'joystick',
          binding: { key: 'W', modifiers: [] },
          xNorm: 0.18,
          yNorm: 0.72,
          radiusNorm: 0.11,
          wasdKeys: { up: 'W', down: 'S', left: 'A', right: 'D' },
        },
        {
          id: 'ctrl_aim',
          label: 'Look / Aim',
          kind: 'aim_pan',
          binding: { key: 'MouseLook', modifiers: [] },
          xNorm: 0.72,
          yNorm: 0.45,
          radiusNorm: 0.12,
          sensitivity: 0.0022,
        },
        {
          id: 'ctrl_jump',
          label: 'Jump',
          kind: 'tap',
          binding: { key: 'Space', modifiers: [] },
          xNorm: 0.88,
          yNorm: 0.68,
        },
        {
          id: 'ctrl_free_mouse',
          label: 'Free Mouse',
          kind: 'free_mouse',
          binding: { key: 'Tab', modifiers: [] },
          xNorm: 0.92,
          yNorm: 0.12,
        },
      ],
    },
    {
      id: 'layout_2',
      number: 2,
      name: 'Vehicle',
      freeMouseKey: 'Tab',
      controls: [
        {
          id: 'ctrl_steer',
          label: 'Steer (A/D)',
          kind: 'joystick',
          binding: { key: 'A', modifiers: [] },
          xNorm: 0.18,
          yNorm: 0.75,
          radiusNorm: 0.1,
          wasdKeys: { up: 'W', down: 'S', left: 'A', right: 'D' },
        },
        {
          id: 'ctrl_gas',
          label: 'Accelerate',
          kind: 'tap',
          binding: { key: 'W', modifiers: [] },
          xNorm: 0.88,
          yNorm: 0.75,
        },
        {
          id: 'ctrl_brake',
          label: 'Brake',
          kind: 'tap',
          binding: { key: 'S', modifiers: [] },
          xNorm: 0.78,
          yNorm: 0.82,
        },
      ],
    },
    {
      id: 'layout_3',
      number: 3,
      name: 'Flying',
      freeMouseKey: 'Tab',
      controls: [
        {
          id: 'ctrl_tilt',
          label: 'Tilt Stick',
          kind: 'joystick',
          binding: { key: 'W', modifiers: [] },
          xNorm: 0.2,
          yNorm: 0.68,
          radiusNorm: 0.12,
          wasdKeys: { up: 'W', down: 'S', left: 'A', right: 'D' },
        },
        {
          id: 'ctrl_throttle_up',
          label: 'Throttle +',
          kind: 'tap',
          binding: { key: 'Shift', modifiers: [] },
          xNorm: 0.88,
          yNorm: 0.6,
        },
      ],
    },
  ];
}
