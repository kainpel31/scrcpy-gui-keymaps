import React, { useEffect, useRef, useState } from "react";
import {
  GameLayout,
  KEY_PICKER_GRID,
  KEY_PICKER_SPECIALS,
  MacroStep,
  MappedControl,
  ModifierKey,
  PressedBySource,
  TouchDispatchPayload,
  TriggerBehavior,
  computeWasdVector,
  decodeLayoutShareCode,
  encodeLayoutShareCode,
  getBindingSignature,
  joystickToTouchCoords,
} from "../types/keymap";

interface ScreenOverlayKeymapperProps {
  activeDevice: string | null;
  layouts: GameLayout[];
  activeLayoutId: string;
  deviceWidth: number;
  deviceHeight: number;
  onSelectLayout: (layoutId: string) => void;
  onChangeLayouts: (nextLayouts: GameLayout[]) => void;
  onDispatchTouch: (payload: TouchDispatchPayload) => void;
  onCloseOverlay: () => void;
}

const ALL_MODIFIERS: ModifierKey[] = ["Ctrl", "Shift", "Alt"];
const BEHAVIORS: TriggerBehavior[] = ["Tap", "Hold", "Repeat", "Toggle"];

function extractModifiers(e: KeyboardEvent): ModifierKey[] {
  const mods: ModifierKey[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.shiftKey) mods.push("Shift");
  if (e.altKey) mods.push("Alt");
  return mods;
}

function normalizeKeyName(key: string): string {
  if (key === " ") return "SPC";
  if (key === "Escape") return "ESC";
  if (key === "Control") return "CTR";
  if (key === "Shift") return "SHI";
  if (key === "ArrowUp") return "UP";
  if (key === "ArrowDown") return "DOW";
  if (key === "ArrowLeft") return "LEF";
  if (key === "ArrowRight") return "RIG";
  if (key.length === 1) return key.toUpperCase();
  return key.toUpperCase();
}

export const ScreenOverlayKeymapper: React.FC<ScreenOverlayKeymapperProps> = ({
  activeDevice,
  layouts,
  activeLayoutId,
  deviceWidth,
  deviceHeight,
  onSelectLayout,
  onChangeLayouts,
  onDispatchTouch,
  onCloseOverlay,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const joystickActiveRef = useRef<boolean>(false);
  const aimActiveRef = useRef<boolean>(false);
  const aimCurrentNormRef = useRef<{ x: number; y: number } | null>(null);
  const inspectorDragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  const [isEditing, setIsEditing] = useState<boolean>(true);
  const [saveStateLabel, setSaveStateLabel] = useState<"SAVED" | "SAVING...">("SAVED");
  const [layoutMenuOpen, setLayoutMenuOpen] = useState<boolean>(false);
  const [addMenuOpen, setAddMenuOpen] = useState<boolean>(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState<boolean>(false);
  const [keyPickerOpen, setKeyPickerOpen] = useState<boolean>(false);
  const [keyPickerChordMods, setKeyPickerChordMods] = useState<ModifierKey[]>([]);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedControlId, setSelectedControlId] = useState<string | null>("ctrl_tab");
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(true);
  const [showMoreDetails, setShowMoreDetails] = useState<boolean>(false);
  const [inspectorPos, setInspectorPos] = useState<{ x: number; y: number }>({
    x: 345,
    y: 120,
  });
  const [draggingInspector, setDraggingInspector] = useState<boolean>(false);

  const [mouseFree, setMouseFree] = useState<boolean>(false);
  const [isRecordingMacro, setIsRecordingMacro] = useState<boolean>(false);
  const [macroSequenceTarget, setMacroSequenceTarget] = useState<"primary" | "secondary">("primary");
  const [macroToolMode, setMacroToolMode] = useState<"tap" | "swipe">("tap");
  const [pendingSwipeStart, setPendingSwipeStart] = useState<{ x: number; y: number } | null>(null);
  const [shareCodeText, setShareCodeText] = useState<string>("");

  const [pastStack, setPastStack] = useState<GameLayout[][]>([]);
  const [futureStack, setFutureStack] = useState<GameLayout[][]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState<GameLayout[]>(() =>
    JSON.parse(JSON.stringify(layouts))
  );

  const activeLayout = layouts.find((l) => l.id === activeLayoutId) ?? layouts[0];
  const selectedControl =
    activeLayout.controls.find((c) => c.id === selectedControlId) ?? null;

  const commitLayouts = (nextLayouts: GameLayout[], recordHistory = true) => {
    if (recordHistory) {
      setPastStack((prev) => [...prev.slice(-30), JSON.parse(JSON.stringify(layouts))]);
      setFutureStack([]);
    }
    setSaveStateLabel("SAVING...");
    onChangeLayouts(nextLayouts);
  };

  const commitActiveLayout = (updated: GameLayout, recordHistory = true) => {
    commitLayouts(
      layouts.map((l) => (l.id === updated.id ? updated : l)),
      recordHistory
    );
  };

  const handleSave = () => {
    const cloned = JSON.parse(JSON.stringify(layouts));
    setSavedSnapshot(cloned);
    localStorage.setItem("scrcpy_gui_visual_layouts_v1", JSON.stringify(cloned));
    setSaveStateLabel("SAVED");
  };

  const handleUndo = () => {
    if (pastStack.length === 0) return;
    const previous = pastStack[pastStack.length - 1];
    setFutureStack((prev) => [JSON.parse(JSON.stringify(layouts)), ...prev]);
    setPastStack((prev) => prev.slice(0, -1));
    onChangeLayouts(previous);
  };

  const handleRedo = () => {
    if (futureStack.length === 0) return;
    const next = futureStack[0];
    setPastStack((prev) => [...prev, JSON.parse(JSON.stringify(layouts))]);
    setFutureStack((prev) => prev.slice(1));
    onChangeLayouts(next);
  };

  const handleRevert = () => {
    commitLayouts(JSON.parse(JSON.stringify(savedSnapshot)), true);
  };

  const toDeviceCoords = (xNorm: number, yNorm: number) => ({
    x: Math.round(Math.max(0, Math.min(1, xNorm)) * deviceWidth),
    y: Math.round(Math.max(0, Math.min(1, yNorm)) * deviceHeight),
  });

  const appendMacroStep = (step: MacroStep) => {
    if (!selectedControl || selectedControl.kind !== "macro" || !selectedControl.macro) return;
    commitActiveLayout({
      ...activeLayout,
      controls: activeLayout.controls.map((c) => {
        if (c.id !== selectedControl.id || !c.macro) return c;
        return {
          ...c,
          macro:
            macroSequenceTarget === "primary"
              ? { ...c.macro, primarySteps: [...c.macro.primarySteps, step] }
              : {
                  ...c.macro,
                  secondarySteps: [...(c.macro.secondarySteps ?? []), step],
                },
        };
      }),
    });
  };

  const runMacroSteps = async (steps: MacroStep[]) => {
    for (const step of steps) {
      if (step.type === "wait") {
        await new Promise((r) => setTimeout(r, step.durationMs));
      } else if (step.type === "tap") {
        const pt = toDeviceCoords(step.xNorm, step.yNorm);
        onDispatchTouch({
          action: "tap",
          x: pt.x,
          y: pt.y,
          durationMs: step.durationMs ?? 60,
          pointerId: 1,
        });
      } else if (step.type === "swipe") {
        const from = toDeviceCoords(step.fromXNorm, step.fromYNorm);
        const to = toDeviceCoords(step.toXNorm, step.toYNorm);
        onDispatchTouch({
          action: "swipe",
          x: from.x,
          y: from.y,
          toX: to.x,
          toY: to.y,
          durationMs: step.durationMs,
          pointerId: 1,
        });
      } else if (step.type === "toggle_mouse") {
        if (step.mode === "free") setMouseFree(true);
        else if (step.mode === "aim") setMouseFree(false);
        else setMouseFree((v) => !v);
      } else if (step.type === "key") {
        const target = activeLayout.controls.find(
          (c) =>
            getBindingSignature(c.binding) ===
            getBindingSignature({ key: step.key, modifiers: step.modifiers ?? [] })
        );
        if (target) {
          const pt = toDeviceCoords(target.xNorm, target.yNorm);
          onDispatchTouch({ action: "tap", x: pt.x, y: pt.y, durationMs: 60, pointerId: 2 });
        }
      }
    }
  };

  const syncJoystickState = () => {
    const joy = activeLayout.controls.find((c) => c.kind === "joystick");
    if (!joy) return;

    const vec = computeWasdVector(pressedKeysRef.current, joy.wasdKeys);
    const center = toDeviceCoords(joy.xNorm, joy.yNorm);
    const isRunning =
      !!joy.runKey && pressedKeysRef.current.has(joy.runKey.toUpperCase());
    const effRadiusNorm = isRunning
      ? joy.runReachNorm ?? (joy.radiusNorm ?? 0.11) * 1.6
      : joy.radiusNorm ?? 0.11;
    const radiusPx = Math.round(effRadiusNorm * Math.min(deviceWidth, deviceHeight));
    const isMoving = vec.dx !== 0 || vec.dy !== 0;

    if (isMoving && !joystickActiveRef.current) {
      joystickActiveRef.current = true;
      onDispatchTouch({ action: "down", x: center.x, y: center.y, pointerId: 10 });
      const target = joystickToTouchCoords(center.x, center.y, radiusPx, vec);
      onDispatchTouch({ action: "move", x: target.x, y: target.y, pointerId: 10 });
    } else if (isMoving && joystickActiveRef.current) {
      const target = joystickToTouchCoords(center.x, center.y, radiusPx, vec);
      onDispatchTouch({ action: "move", x: target.x, y: target.y, pointerId: 10 });
    } else if (!isMoving && joystickActiveRef.current) {
      joystickActiveRef.current = false;
      onDispatchTouch({ action: "up", x: center.x, y: center.y, pointerId: 10 });
    }
  };

  const triggerSingleControl = (ctrl: MappedControl) => {
    if (ctrl.kind === "free_mouse" || ctrl.opensMenu) {
      setMouseFree((v) => !v);
      return;
    }

    if (ctrl.kind === "macro" && ctrl.macro) {
      const idx = ctrl.macro.nextToggleIndex;
      const steps =
        idx === 1 && ctrl.macro.secondarySteps && ctrl.macro.secondarySteps.length > 0
          ? ctrl.macro.secondarySteps
          : ctrl.macro.primarySteps;

      const nextIdx: 0 | 1 =
        ctrl.macro.secondarySteps && ctrl.macro.secondarySteps.length > 0
          ? idx === 0
            ? 1
            : 0
          : 0;

      commitActiveLayout(
        {
          ...activeLayout,
          controls: activeLayout.controls.map((c) =>
            c.id === ctrl.id && c.macro
              ? { ...c, macro: { ...c.macro, nextToggleIndex: nextIdx } }
              : c
          ),
        },
        false
      );

      void runMacroSteps(steps);
      return;
    }

    if (ctrl.kind === "tap") {
      const pt = toDeviceCoords(ctrl.xNorm, ctrl.yNorm);
      onDispatchTouch({
        action: "tap",
        x: pt.x,
        y: pt.y,
        durationMs: ctrl.behavior === "Repeat" ? 45 : 70,
        pointerId: 1,
      });
    }
  };

  useEffect(() => {
    if (isEditing) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const keyName = normalizeKeyName(e.key);
      const mods = extractModifiers(e);

      if (
        keyName.toLowerCase() === activeLayout.freeMouseKey.toLowerCase() &&
        mods.length === 0
      ) {
        if (!e.repeat) {
          e.preventDefault();
          setMouseFree((v) => !v);
        }
        return;
      }

      if (mods.length === 0) {
        pressedKeysRef.current.add(keyName.toUpperCase());
        const hasJoyOrRunKey = activeLayout.controls.some((c) => {
          if (c.kind !== "joystick") return false;
          const keys = [
            ...Object.values(c.wasdKeys ?? { up: "W", down: "S", left: "A", right: "D" }),
            ...(c.runKey ? [c.runKey] : []),
          ].map((k) => k.toUpperCase());
          return keys.includes(keyName.toUpperCase());
        });
        if (hasJoyOrRunKey) {
          e.preventDefault();
          syncJoystickState();
        }
      }

      if (e.repeat) return;

      const incomingSig = getBindingSignature({ key: keyName, modifiers: mods });
      const matched = activeLayout.controls.find(
        (c) =>
          c.kind !== "joystick" &&
          c.kind !== "aim_pan" &&
          getBindingSignature(c.binding) === incomingSig
      );

      if (matched) {
        e.preventDefault();
        triggerSingleControl(matched);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const keyName = normalizeKeyName(e.key).toUpperCase();
      if (pressedKeysRef.current.has(keyName)) {
        pressedKeysRef.current.delete(keyName);
        syncJoystickState();
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (mouseFree) {
        if (aimActiveRef.current && aimCurrentNormRef.current) {
          const pt = toDeviceCoords(aimCurrentNormRef.current.x, aimCurrentNormRef.current.y);
          onDispatchTouch({ action: "up", x: pt.x, y: pt.y, pointerId: 20 });
          aimActiveRef.current = false;
          aimCurrentNormRef.current = null;
        }
        return;
      }

      const aimCtrl = activeLayout.controls.find((c) => c.kind === "aim_pan");
      if (!aimCtrl) return;

      const sens = aimCtrl.sensitivity ?? 0.0022;
      if (!aimActiveRef.current || !aimCurrentNormRef.current) {
        aimActiveRef.current = true;
        aimCurrentNormRef.current = { x: aimCtrl.xNorm, y: aimCtrl.yNorm };
        const startPt = toDeviceCoords(aimCtrl.xNorm, aimCtrl.yNorm);
        onDispatchTouch({ action: "down", x: startPt.x, y: startPt.y, pointerId: 20 });
      }

      const nextX = Math.max(
        0.05,
        Math.min(0.95, aimCurrentNormRef.current.x + e.movementX * sens)
      );
      const nextY = Math.max(
        0.05,
        Math.min(0.95, aimCurrentNormRef.current.y + e.movementY * sens)
      );
      aimCurrentNormRef.current = { x: nextX, y: nextY };
      const pt = toDeviceCoords(nextX, nextY);
      onDispatchTouch({ action: "move", x: pt.x, y: pt.y, pointerId: 20 });
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  });

  // Tangkap tekanan keyboard saat key picker terbuka di inspector
  useEffect(() => {
    if (!keyPickerOpen || !selectedControl) return;

    const onPickerKeyDown = (e: KeyboardEvent) => {
      const mods = extractModifiers(e);
      setKeyPickerChordMods(mods);
      const norm = normalizeKeyName(e.key);
      if (["Control", "Shift", "Alt"].includes(e.key)) return;
      e.preventDefault();
      commitActiveLayout({
        ...activeLayout,
        controls: activeLayout.controls.map((c) =>
          c.id === selectedControl.id
            ? {
                ...c,
                label: `Key ${norm}`,
                binding: { key: norm, modifiers: mods },
              }
            : c
        ),
      });
      setKeyPickerOpen(false);
    };

    window.addEventListener("keydown", onPickerKeyDown);
    return () => window.removeEventListener("keydown", onPickerKeyDown);
  });

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingInspector && stageRef.current) {
      const rect = stageRef.current.getBoundingClientRect();
      setInspectorPos({
        x: Math.max(
          16,
          Math.min(rect.width - 300, e.clientX - rect.left - inspectorDragOffsetRef.current.dx)
        ),
        y: Math.max(
          16,
          Math.min(rect.height - 280, e.clientY - rect.top - inspectorDragOffsetRef.current.dy)
        ),
      });
      return;
    }

    if (!isEditing || !draggingId || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const xNorm = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const yNorm = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    commitActiveLayout(
      {
        ...activeLayout,
        controls: activeLayout.controls.map((c) =>
          c.id === draggingId ? { ...c, xNorm, yNorm } : c
        ),
      },
      false
    );
  };

  const handleStagePointerUp = () => {
    if (draggingId) {
      setPastStack((prev) => [...prev.slice(-30), JSON.parse(JSON.stringify(layouts))]);
      setFutureStack([]);
      setDraggingId(null);
    }
    if (draggingInspector) {
      setDraggingInspector(false);
    }
  };

  const handleControlWheel = (
    e: React.WheelEvent<HTMLDivElement>,
    ctrl: MappedControl
  ) => {
    if (!isEditing) return;
    e.stopPropagation();

    if (e.shiftKey) {
      // Shift + scroll = fade / opacity
      const deltaFade = e.deltaY < 0 ? 0.05 : -0.05;
      const nextFade = Math.max(0.15, Math.min(1, (ctrl.fade ?? 0.85) + deltaFade));
      commitActiveLayout(
        {
          ...activeLayout,
          controls: activeLayout.controls.map((c) =>
            c.id === ctrl.id ? { ...c, fade: Number(nextFade.toFixed(2)) } : c
          ),
        },
        false
      );
    } else {
      // Scroll = resize scale
      const deltaScale = e.deltaY < 0 ? 0.08 : -0.08;
      const nextScale = Math.max(0.6, Math.min(1.8, (ctrl.scale ?? 1) + deltaScale));
      commitActiveLayout(
        {
          ...activeLayout,
          controls: activeLayout.controls.map((c) =>
            c.id === ctrl.id ? { ...c, scale: Number(nextScale.toFixed(2)) } : c
          ),
        },
        false
      );
    }
  };

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isEditing || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const xNorm = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const yNorm = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    if (isRecordingMacro && selectedControl && selectedControl.kind === "macro") {
      if (macroToolMode === "tap") {
        appendMacroStep({
          id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: "tap",
          xNorm,
          yNorm,
          durationMs: 60,
        });
      } else if (macroToolMode === "swipe") {
        if (!pendingSwipeStart) {
          setPendingSwipeStart({ x: xNorm, y: yNorm });
        } else {
          appendMacroStep({
            id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: "swipe",
            fromXNorm: pendingSwipeStart.x,
            fromYNorm: pendingSwipeStart.y,
            toXNorm: xNorm,
            toYNorm: yNorm,
            durationMs: 200,
          });
          setPendingSwipeStart(null);
        }
      }
    }
  };

  const addControl = (kind: MappedControl["kind"], keyLabel?: string) => {
    const id = `ctrl_${Date.now()}`;
    const nextNum = activeLayout.controls.length + 1;
    const resolvedKey =
      keyLabel ?? (kind === "free_mouse" ? "TAB" : kind === "joystick" ? "W" : `F${nextNum}`);

    const newCtrl: MappedControl = {
      id,
      label: kind === "joystick" ? "WASD" : `Key ${resolvedKey}`,
      kind,
      binding: {
        key: resolvedKey,
        modifiers: [],
      },
      xNorm: 0.5,
      yNorm: 0.5,
      radiusNorm: kind === "joystick" || kind === "aim_pan" ? 0.11 : undefined,
      runReachNorm: kind === "joystick" ? 0.21 : undefined,
      runKey: kind === "joystick" ? "Shift" : undefined,
      scale: 1,
      fade: 0.85,
      sensitivity: kind === "aim_pan" ? 0.0022 : undefined,
      behavior: kind === "joystick" ? "Hold" : "Tap",
      pressedBy: "Key",
      wasdKeys:
        kind === "joystick" ? { up: "W", down: "S", left: "A", right: "D" } : undefined,
      ...(kind === "macro"
        ? {
            macro: {
              primarySteps: [],
              secondarySteps: [],
              nextToggleIndex: 0,
            },
          }
        : {}),
    };

    commitActiveLayout({
      ...activeLayout,
      controls: [...activeLayout.controls, newCtrl],
    });
    setSelectedControlId(id);
    setInspectorOpen(true);
    setAddMenuOpen(false);
  };

  const addNewLayout = () => {
    const nextNum = layouts.length + 1;
    const newLayout: GameLayout = {
      id: `layout_${Date.now()}`,
      number: nextNum,
      name: `Layout ${nextNum} - mirror`,
      freeMouseKey: "Tab",
      controls: [],
    };
    const nextAll = [...layouts, newLayout];
    commitLayouts(nextAll);
    onSelectLayout(newLayout.id);
    setLayoutMenuOpen(false);
  };

  const toggleModifierOnSelected = (mod: ModifierKey) => {
    if (!selectedControl) return;
    const exists = selectedControl.binding.modifiers.includes(mod);
    const nextMods = exists
      ? selectedControl.binding.modifiers.filter((m) => m !== mod)
      : [...selectedControl.binding.modifiers, mod];

    commitActiveLayout({
      ...activeLayout,
      controls: activeLayout.controls.map((c) =>
        c.id === selectedControl.id
          ? { ...c, binding: { ...c.binding, modifiers: nextMods } }
          : c
      ),
    });
  };

  const updateSelectedControl = (patch: Partial<MappedControl>) => {
    if (!selectedControl) return;
    commitActiveLayout({
      ...activeLayout,
      controls: activeLayout.controls.map((c) =>
        c.id === selectedControl.id ? { ...c, ...patch } : c
      ),
    });
  };

  const joystickCtrl = activeLayout.controls.find((c) => c.kind === "joystick");

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950/55 text-zinc-100 select-none">
      {/* Top Device Bar (102752537K009428 USB | Paused: keys go to Windows | Record) */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-950/95 border-b border-zinc-800 text-xs">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 font-mono text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {activeDevice || "102752537K009428 USB"}
          </span>

          <button
            type="button"
            onClick={() => setIsEditing((v) => !v)}
            className="px-2.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px]"
          >
            {isEditing ? "Editing overlay" : "Paused: keys go to Windows"}
          </button>

          <button
            type="button"
            onClick={() => setIsRecordingMacro((v) => !v)}
            className={`px-2.5 py-0.5 rounded text-[11px] font-semibold ${
              isRecordingMacro
                ? "bg-rose-600 text-white"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            }`}
          >
            {isRecordingMacro ? "Stop Record" : "Record"}
          </button>
        </div>

        <div className="text-[11px] text-zinc-400">
          {deviceWidth}x{deviceHeight}
        </div>
      </div>

      {/* Editor Sub-Bar (Layout 1 - mirror v | Add v | hint | SAVING... | Undo | More v | Done) */}
      <div className="relative flex items-center justify-between px-3 py-1.5 bg-zinc-900/95 border-b border-zinc-800 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setLayoutMenuOpen((v) => !v);
                setAddMenuOpen(false);
                setMoreMenuOpen(false);
              }}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 font-semibold"
            >
              {activeLayout.name} ▾
            </button>

            {layoutMenuOpen && (
              <div className="absolute left-0 mt-1 w-56 rounded-lg bg-zinc-900 border border-zinc-700 shadow-2xl z-50 p-1.5 space-y-1">
                {layouts.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => {
                      onSelectLayout(l.id);
                      setLayoutMenuOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded text-xs ${
                      l.id === activeLayout.id
                        ? "bg-emerald-600 text-white font-bold"
                        : "hover:bg-zinc-800 text-zinc-200"
                    }`}
                  >
                    {l.number}. {l.name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={addNewLayout}
                  className="w-full text-left px-2.5 py-1.5 rounded text-xs text-emerald-300 hover:bg-zinc-800 font-semibold"
                >
                  + New Layout
                </button>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setAddMenuOpen((v) => !v);
                setLayoutMenuOpen(false);
                setMoreMenuOpen(false);
              }}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 font-semibold"
            >
              Add ▾
            </button>

            {addMenuOpen && (
              <div className="absolute left-0 mt-1 w-44 rounded-lg bg-zinc-900 border border-zinc-700 shadow-2xl z-50 p-1 space-y-0.5">
                <button
                  type="button"
                  onClick={() => addControl("tap")}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-zinc-800"
                >
                  Tap Key
                </button>
                <button
                  type="button"
                  onClick={() => addControl("joystick")}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-zinc-800"
                >
                  WASD Joystick
                </button>
                <button
                  type="button"
                  onClick={() => addControl("aim_pan")}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-zinc-800"
                >
                  Aim / Look Area
                </button>
                <button
                  type="button"
                  onClick={() => addControl("macro")}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-zinc-800"
                >
                  Macro Sequence
                </button>
                <button
                  type="button"
                  onClick={() => addControl("free_mouse")}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-zinc-800"
                >
                  Free Mouse Toggle
                </button>
              </div>
            )}
          </div>

          <span className="text-[11px] text-zinc-400 truncate hidden md:inline">
            drag to move · scroll over it to size · Shift+scroll to fade
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] tracking-wider uppercase text-zinc-400 mr-1">
            {saveStateLabel}
          </span>

          <button
            type="button"
            onClick={handleUndo}
            disabled={pastStack.length === 0}
            className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 font-semibold"
          >
            Undo
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setMoreMenuOpen((v) => !v);
                setLayoutMenuOpen(false);
                setAddMenuOpen(false);
              }}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 font-semibold"
            >
              More ▾
            </button>

            {moreMenuOpen && (
              <div className="absolute right-0 mt-1 w-60 rounded-lg bg-zinc-900 border border-zinc-700 shadow-2xl z-50 p-2 space-y-2 text-xs">
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={handleRedo}
                    disabled={futureStack.length === 0}
                    className="flex-1 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40"
                  >
                    Redo
                  </button>
                  <button
                    type="button"
                    onClick={handleRevert}
                    className="flex-1 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
                  >
                    Revert
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    className="flex-1 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
                  >
                    Save
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const code = encodeLayoutShareCode(activeLayout);
                    setShareCodeText(code);
                    void navigator.clipboard?.writeText(code);
                  }}
                  className="w-full py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 font-semibold"
                >
                  Copy Share Code
                </button>

                <input
                  type="text"
                  placeholder="Paste share code..."
                  value={shareCodeText}
                  onChange={(e) => setShareCodeText(e.target.value)}
                  className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700"
                />

                <button
                  type="button"
                  onClick={() => {
                    const parsed = decodeLayoutShareCode(shareCodeText);
                    if (!parsed) return;
                    const imported: GameLayout = {
                      ...parsed,
                      id: `layout_${Date.now()}`,
                      number: layouts.length + 1,
                    };
                    commitLayouts([...layouts, imported]);
                    onSelectLayout(imported.id);
                    setMoreMenuOpen(false);
                  }}
                  className="w-full py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                >
                  Import Share Code
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              handleSave();
              setIsEditing(false);
              onCloseOverlay();
            }}
            className="px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold"
          >
            Done
          </button>
        </div>
      </div>

      {/* Screen-Mirror Overlay Stage */}
      <div
        ref={stageRef}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerUp}
        onClick={handleStageClick}
        className={`relative flex-1 bg-transparent overflow-hidden ${
          mouseFree || isEditing ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        {/* Joystick Outer / Inner Rings & Sprint Reach Arc */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {joystickCtrl && (
            <>
              <circle
                cx={`${joystickCtrl.xNorm * 100}%`}
                cy={`${joystickCtrl.yNorm * 100}%`}
                r={`${(joystickCtrl.radiusNorm ?? 0.11) * 100}%`}
                fill="none"
                stroke="rgba(255,255,255,0.35)"
                strokeWidth="1.5"
              />
              <circle
                cx={`${joystickCtrl.xNorm * 100}%`}
                cy={`${joystickCtrl.yNorm * 100}%`}
                r={`${((joystickCtrl.radiusNorm ?? 0.11) * 1.45) * 100}%`}
                fill="none"
                stroke="rgba(255,255,255,0.2)"
                strokeWidth="1.2"
              />
              {joystickCtrl.runReachNorm && (
                <path
                  d={`M ${(joystickCtrl.xNorm - 0.05) * 100}% ${(joystickCtrl.yNorm - joystickCtrl.runReachNorm) * 100}% Q ${joystickCtrl.xNorm * 100}% ${(joystickCtrl.yNorm - joystickCtrl.runReachNorm - 0.025) * 100}% ${(joystickCtrl.xNorm + 0.05) * 100}% ${(joystickCtrl.yNorm - joystickCtrl.runReachNorm) * 100}%`}
                  fill="none"
                  stroke="rgba(255,255,255,0.55)"
                  strokeWidth="1.5"
                />
              )}
            </>
          )}
        </svg>

        {/* Draggable Circle Badges Over Screen Mirror */}
        {activeLayout.controls.map((ctrl) => {
          const sig = getBindingSignature(ctrl.binding);
          const isSelected = ctrl.id === selectedControlId;
          const isJoy = ctrl.kind === "joystick";
          return (
            <div
              key={ctrl.id}
              onPointerDown={(e) => {
                if (!isEditing) return;
                e.stopPropagation();
                setSelectedControlId(ctrl.id);
                setInspectorOpen(true);
                setDraggingId(ctrl.id);
              }}
              onWheel={(e) => handleControlWheel(e, ctrl)}
              style={{
                left: `${ctrl.xNorm * 100}%`,
                top: `${ctrl.yNorm * 100}%`,
                opacity: ctrl.fade ?? 0.85,
                transform: `translate(-50%, -50%) scale(${ctrl.scale ?? 1})`,
              }}
              className={`absolute flex items-center justify-center rounded-full font-bold border shadow cursor-grab active:cursor-grabbing ${
                isJoy
                  ? "w-24 h-24 text-sm bg-black/35 border-white/60 text-white"
                  : "w-10 h-10 text-[11px] bg-black/55 border-white/75 text-white"
              } ${isSelected ? "ring-2 ring-emerald-400 border-emerald-300" : ""}`}
            >
              <span>{isJoy ? "WASD" : sig}</span>
            </div>
          );
        })}

        {/* Floating Key Inspector Card (Mirip image_0f2324.jpg) */}
        {isEditing && inspectorOpen && selectedControl && (
          <div
            style={{ left: `${inspectorPos.x}px`, top: `${inspectorPos.y}px` }}
            onClick={(e) => e.stopPropagation()}
            className="absolute z-30 w-80 rounded-xl bg-zinc-900/95 border border-zinc-700 shadow-2xl text-xs text-zinc-100 overflow-hidden"
          >
            {/* Card Header */}
            <div
              onPointerDown={(e) => {
                e.stopPropagation();
                inspectorDragOffsetRef.current = {
                  dx: e.clientX - inspectorPos.x,
                  dy: e.clientY - inspectorPos.y,
                };
                setDraggingInspector(true);
              }}
              className="flex items-center justify-between px-3.5 py-2.5 border-b border-zinc-800 cursor-move"
            >
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setKeyPickerOpen((v) => !v)}
                  className="w-8 h-8 rounded-full bg-emerald-500 text-zinc-950 font-extrabold text-[11px] flex items-center justify-center"
                >
                  {selectedControl.binding.key}
                </button>
                <div>
                  <div className="font-bold text-sm leading-tight">
                    {selectedControl.label}
                  </div>
                  <button
                    type="button"
                    onClick={() => setKeyPickerOpen((v) => !v)}
                    className="text-[11px] text-zinc-400 hover:text-zinc-200"
                  >
                    click the key to change it
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setInspectorOpen(false)}
                className="text-zinc-400 hover:text-white px-1.5 py-0.5 rounded"
              >
                ✕
              </button>
            </div>

            {/* Behavior Tabs (Tap / Hold / Repeat / Toggle) */}
            <div className="grid grid-cols-4 border-b border-zinc-800 text-[11px]">
              {BEHAVIORS.map((b) => {
                const active = (selectedControl.behavior ?? "Tap") === b;
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => updateSelectedControl({ behavior: b })}
                    className={`py-2 font-semibold border-b-2 ${
                      active
                        ? "border-emerald-400 text-emerald-300 bg-zinc-800/50"
                        : "border-transparent text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {b}
                  </button>
                );
              })}
            </div>

            <div className="p-3.5 space-y-3 max-h-[420px] overflow-y-auto">
              {/* Opens a menu */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">Opens a menu</div>
                  <div className="text-[11px] text-zinc-400 leading-snug">
                    Frees the mouse; the game's close button takes it back
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={!!selectedControl.opensMenu}
                  onChange={(e) =>
                    updateSelectedControl({ opensMenu: e.target.checked })
                  }
                  className="accent-emerald-500 w-4 h-4"
                />
              </div>

              {/* When held */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">When held</div>
                  <div className="text-[11px] text-zinc-400 leading-snug">
                    Hold the key for a second button — a tap lands when you let go
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={!!selectedControl.whenHeld}
                  onChange={(e) =>
                    updateSelectedControl({ whenHeld: e.target.checked })
                  }
                  className="accent-emerald-500 w-4 h-4"
                />
              </div>

              <button
                type="button"
                onClick={() => setShowMoreDetails((v) => !v)}
                className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] font-bold tracking-wider"
              >
                {showMoreDetails ? "LESS" : "MORE"}
              </button>

              {/* Pressed by */}
              <div className="space-y-1.5">
                <div className="text-[11px] text-zinc-400">Pressed by</div>
                <div className="grid grid-cols-2 rounded-lg bg-zinc-950 p-1 border border-zinc-800">
                  {(["Key", "MMB"] as PressedBySource[]).map((src) => {
                    const active = (selectedControl.pressedBy ?? "Key") === src;
                    return (
                      <button
                        key={src}
                        type="button"
                        onClick={() => updateSelectedControl({ pressedBy: src })}
                        className={`py-1 rounded text-xs font-semibold ${
                          active
                            ? "bg-emerald-500 text-zinc-950"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        {src}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Hold with (CTRL / SHIFT / ALT) */}
              <div className="space-y-1.5">
                <div className="text-[11px] text-zinc-400">Hold with</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {ALL_MODIFIERS.map((mod) => {
                    const active = selectedControl.binding.modifiers.includes(mod);
                    return (
                      <button
                        key={mod}
                        type="button"
                        onClick={() => toggleModifierOnSelected(mod)}
                        className={`py-1.5 rounded text-[11px] font-bold border ${
                          active
                            ? "bg-emerald-500/20 border-emerald-400 text-emerald-200"
                            : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        {mod.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Mouse drags it while held */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">Mouse drags it while held</div>
                  <div className="text-[11px] text-zinc-400 leading-snug">
                    A free cursor that turns the view
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={!!selectedControl.mouseDragsWhileHeld}
                  onChange={(e) =>
                    updateSelectedControl({
                      mouseDragsWhileHeld: e.target.checked,
                      kind: e.target.checked ? "aim_pan" : selectedControl.kind,
                    })
                  }
                  className="accent-emerald-500 w-4 h-4"
                />
              </div>

              {/* Fade Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-zinc-400">Fade</span>
                  <span className="font-mono text-zinc-300">
                    {Math.round((selectedControl.fade ?? 0.85) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={15}
                  max={100}
                  value={Math.round((selectedControl.fade ?? 0.85) * 100)}
                  onChange={(e) =>
                    updateSelectedControl({ fade: Number(e.target.value) / 100 })
                  }
                  className="w-full accent-emerald-500"
                />
              </div>

              {showMoreDetails && selectedControl.kind === "macro" && selectedControl.macro && (
                <div className="space-y-2 pt-2 border-t border-zinc-800">
                  <select
                    value={macroSequenceTarget}
                    onChange={(e) =>
                      setMacroSequenceTarget(
                        e.target.value as "primary" | "secondary"
                      )
                    }
                    className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700"
                  >
                    <option value="primary">1st Press Sequence</option>
                    <option value="secondary">2nd Press Sequence (Next Press)</option>
                  </select>
                  <div className="flex gap-1.5">
                    <select
                      value={macroToolMode}
                      onChange={(e) => {
                        setMacroToolMode(e.target.value as "tap" | "swipe");
                        setPendingSwipeStart(null);
                      }}
                      className="flex-1 px-2 py-1 rounded bg-zinc-950 border border-zinc-700"
                    >
                      <option value="tap">Tap</option>
                      <option value="swipe">Swipe</option>
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        appendMacroStep({
                          id: `step_${Date.now()}`,
                          type: "wait",
                          durationMs: 150,
                        })
                      }
                      className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
                    >
                      + Wait
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Key Picker Popover Grid (Mirip image_0f228c.jpg di kanan bawah) */}
        {isEditing && keyPickerOpen && selectedControl && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute right-5 bottom-5 z-40 w-64 rounded-xl bg-zinc-900/95 border border-zinc-700 shadow-2xl p-2.5 text-xs space-y-2"
          >
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span>Press a key · hold Ctrl, Shift or Alt for a chord</span>
              <button
                type="button"
                onClick={() => setKeyPickerOpen(false)}
                className="text-zinc-300 hover:text-white px-1"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-6 gap-1">
              {KEY_PICKER_GRID.flat().map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    updateSelectedControl({
                      label: `Key ${k}`,
                      binding: { key: k, modifiers: keyPickerChordMods },
                    });
                    setKeyPickerOpen(false);
                  }}
                  className="py-1.5 rounded bg-zinc-800 hover:bg-emerald-600 hover:text-white font-semibold text-center"
                >
                  {k}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-5 gap-1 pt-1 border-t border-zinc-800">
              {KEY_PICKER_SPECIALS.map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => {
                    updateSelectedControl({
                      label: `Key ${sp}`,
                      binding: { key: sp, modifiers: keyPickerChordMods },
                    });
                    setKeyPickerOpen(false);
                  }}
                  className="py-1.5 rounded bg-zinc-800 hover:bg-emerald-600 hover:text-white font-semibold text-[10px] text-center"
                >
                  {sp}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quick Re-lock Button when Free Mouse is Active */}
        {mouseFree && (
          <button
            type="button"
            onClick={() => setMouseFree(false)}
            aria-label="Lock mouse to aim"
            className="absolute top-3 right-3 z-40 w-8 h-8 rounded-full bg-red-600 hover:bg-red-500 text-white font-bold shadow-lg"
          >
            X
          </button>
        )}
      </div>
    </div>
  );
};
