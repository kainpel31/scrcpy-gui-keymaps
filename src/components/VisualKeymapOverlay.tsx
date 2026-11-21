import React, { useEffect, useRef, useState } from "react";
import {
  GameLayout,
  MacroStep,
  MappedControl,
  ModifierKey,
  TouchDispatchPayload,
  computeWasdVector,
  decodeLayoutShareCode,
  encodeLayoutShareCode,
  getBindingSignature,
  joystickToTouchCoords,
} from "../types/keymap";

interface VisualKeymapOverlayProps {
  layout: GameLayout;
  allLayouts: GameLayout[];
  deviceWidth: number;
  deviceHeight: number;
  isEditing: boolean;
  onToggleEdit: () => void;
  onSelectLayout: (layoutId: string) => void;
  onUpdateLayout: (updated: GameLayout) => void;
  onImportLayout: (imported: GameLayout) => void;
  onDispatchTouch: (payload: TouchDispatchPayload) => void;
  onMouseModeChange?: (mode: "aim" | "free") => void;
}

const ALL_MODIFIERS: ModifierKey[] = ["Ctrl", "Shift", "Alt"];

function extractModifiers(e: KeyboardEvent): ModifierKey[] {
  const mods: ModifierKey[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.shiftKey) mods.push("Shift");
  if (e.altKey) mods.push("Alt");
  return mods;
}

function normalizeKeyName(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export const VisualKeymapOverlay: React.FC<VisualKeymapOverlayProps> = ({
  layout,
  allLayouts,
  deviceWidth,
  deviceHeight,
  isEditing,
  onToggleEdit,
  onSelectLayout,
  onUpdateLayout,
  onImportLayout,
  onDispatchTouch,
  onMouseModeChange,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const joystickActiveRef = useRef<boolean>(false);
  const aimActiveRef = useRef<boolean>(false);
  const aimCurrentNormRef = useRef<{ x: number; y: number } | null>(null);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedControlId, setSelectedControlId] = useState<string | null>(null);
  const [mouseFree, setMouseFree] = useState<boolean>(false);
  const [isRecordingMacro, setIsRecordingMacro] = useState<boolean>(false);
  const [macroSequenceTarget, setMacroSequenceTarget] = useState<"primary" | "secondary">("primary");
  const [pendingSwipeStart, setPendingSwipeStart] = useState<{ x: number; y: number } | null>(null);
  const [macroToolMode, setMacroToolMode] = useState<"tap" | "swipe">("tap");
  const [shareCodeText, setShareCodeText] = useState<string>("");
  const [statusMsg, setStatusMsg] = useState<string>("");

  const selectedControl =
    layout.controls.find((c) => c.id === selectedControlId) ?? null;

  const setFreeMouseState = (free: boolean) => {
    setMouseFree(free);
    onMouseModeChange?.(free ? "free" : "aim");
  };

  const toDeviceCoords = (xNorm: number, yNorm: number) => ({
    x: Math.round(Math.max(0, Math.min(1, xNorm)) * deviceWidth),
    y: Math.round(Math.max(0, Math.min(1, yNorm)) * deviceHeight),
  });

  const appendMacroStep = (step: MacroStep) => {
    if (!selectedControl || selectedControl.kind !== "macro" || !selectedControl.macro) return;
    onUpdateLayout({
      ...layout,
      controls: layout.controls.map((c) => {
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
        if (step.mode === "free") setFreeMouseState(true);
        else if (step.mode === "aim") setFreeMouseState(false);
        else setFreeMouseState(!mouseFree);
      } else if (step.type === "key") {
        const target = layout.controls.find(
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
    const joy = layout.controls.find((c) => c.kind === "joystick");
    if (!joy) return;

    const vec = computeWasdVector(pressedKeysRef.current, joy.wasdKeys);
    const center = toDeviceCoords(joy.xNorm, joy.yNorm);
    const radiusPx = Math.round((joy.radiusNorm ?? 0.11) * Math.min(deviceWidth, deviceHeight));
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
    if (ctrl.kind === "free_mouse") {
      setFreeMouseState(!mouseFree);
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

      onUpdateLayout({
        ...layout,
        controls: layout.controls.map((c) =>
          c.id === ctrl.id && c.macro
            ? { ...c, macro: { ...c.macro, nextToggleIndex: nextIdx } }
            : c
        ),
      });

      void runMacroSteps(steps);
      return;
    }

    if (ctrl.kind === "tap") {
      const pt = toDeviceCoords(ctrl.xNorm, ctrl.yNorm);
      onDispatchTouch({
        action: "tap",
        x: pt.x,
        y: pt.y,
        durationMs: 70,
        pointerId: 1,
      });
    }
  };

  useEffect(() => {
    if (isEditing) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const keyName = normalizeKeyName(e.key);
      const mods = extractModifiers(e);

      if (keyName.toLowerCase() === layout.freeMouseKey.toLowerCase() && mods.length === 0) {
        if (!e.repeat) {
          e.preventDefault();
          setFreeMouseState(!mouseFree);
        }
        return;
      }

      if (mods.length === 0) {
        pressedKeysRef.current.add(keyName.toUpperCase());
        const hasJoyKey = layout.controls.some(
          (c) =>
            c.kind === "joystick" &&
            Object.values(c.wasdKeys ?? { up: "W", down: "S", left: "A", right: "D" })
              .map((k) => k.toUpperCase())
              .includes(keyName.toUpperCase())
        );
        if (hasJoyKey) {
          e.preventDefault();
          syncJoystickState();
        }
      }

      if (e.repeat) return;

      const incomingSig = getBindingSignature({ key: keyName, modifiers: mods });
      const matched = layout.controls.find(
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

      const aimCtrl = layout.controls.find((c) => c.kind === "aim_pan");
      if (!aimCtrl) return;

      const sens = aimCtrl.sensitivity ?? 0.0022;
      if (!aimActiveRef.current || !aimCurrentNormRef.current) {
        aimActiveRef.current = true;
        aimCurrentNormRef.current = { x: aimCtrl.xNorm, y: aimCtrl.yNorm };
        const startPt = toDeviceCoords(aimCtrl.xNorm, aimCtrl.yNorm);
        onDispatchTouch({ action: "down", x: startPt.x, y: startPt.y, pointerId: 20 });
      }

      const nextX = Math.max(0.05, Math.min(0.95, aimCurrentNormRef.current.x + e.movementX * sens));
      const nextY = Math.max(0.05, Math.min(0.95, aimCurrentNormRef.current.y + e.movementY * sens));
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

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isEditing || !draggingId || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const xNorm = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const yNorm = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    onUpdateLayout({
      ...layout,
      controls: layout.controls.map((c) =>
        c.id === draggingId ? { ...c, xNorm, yNorm } : c
      ),
    });
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
        setStatusMsg(
          `Tap (${Math.round(xNorm * 100)}%, ${Math.round(yNorm * 100)}%) ditambahkan ke ${macroSequenceTarget}`
        );
      } else if (macroToolMode === "swipe") {
        if (!pendingSwipeStart) {
          setPendingSwipeStart({ x: xNorm, y: yNorm });
          setStatusMsg("Klik titik akhir swipe di layar...");
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
          setStatusMsg(`Swipe ditambahkan ke ${macroSequenceTarget}`);
        }
      }
    }
  };

  const addControl = (kind: MappedControl["kind"]) => {
    const id = `ctrl_${Date.now()}`;
    const nextNum = layout.controls.length + 1;
    const newCtrl: MappedControl = {
      id,
      label:
        kind === "macro"
          ? `Macro ${nextNum}`
          : kind === "free_mouse"
            ? "Free Mouse"
            : kind === "joystick"
              ? `Stick ${nextNum}`
              : kind === "aim_pan"
                ? "Aim Area"
                : `Key ${nextNum}`,
      kind,
      binding: {
        key: kind === "free_mouse" ? layout.freeMouseKey : `F${nextNum}`,
        modifiers: [],
      },
      xNorm: 0.5,
      yNorm: 0.5,
      radiusNorm: kind === "joystick" || kind === "aim_pan" ? 0.11 : undefined,
      sensitivity: kind === "aim_pan" ? 0.0022 : undefined,
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

    onUpdateLayout({
      ...layout,
      controls: [...layout.controls, newCtrl],
    });
    setSelectedControlId(id);
  };

  const toggleModifierOnSelected = (mod: ModifierKey) => {
    if (!selectedControl) return;
    const exists = selectedControl.binding.modifiers.includes(mod);
    const nextMods = exists
      ? selectedControl.binding.modifiers.filter((m) => m !== mod)
      : [...selectedControl.binding.modifiers, mod];

    onUpdateLayout({
      ...layout,
      controls: layout.controls.map((c) =>
        c.id === selectedControl.id
          ? { ...c, binding: { ...c.binding, modifiers: nextMods } }
          : c
      ),
    });
  };

  return (
    <div className="relative w-full h-full select-none">
      <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-zinc-900/90 border-b border-zinc-800 text-xs text-zinc-100">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-zinc-400 mr-1">Layout:</span>
          {allLayouts.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onSelectLayout(l.id)}
              className={`px-2.5 py-1 rounded font-medium ${
                l.id === layout.id
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              {l.number}. {l.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFreeMouseState(!mouseFree)}
            className={`px-2.5 py-1 rounded ${
              mouseFree ? "bg-amber-600 text-white" : "bg-zinc-800 text-zinc-200"
            }`}
          >
            Mouse: {mouseFree ? "FREE (Click UI)" : `AIM (${layout.freeMouseKey})`}
          </button>

          <button
            type="button"
            onClick={onToggleEdit}
            className={`px-3 py-1 rounded font-semibold ${
              isEditing ? "bg-indigo-600 text-white" : "bg-zinc-700 text-zinc-100"
            }`}
          >
            {isEditing ? "Selesai Edit" : "Edit Keymap"}
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        onPointerMove={handleStagePointerMove}
        onPointerUp={() => setDraggingId(null)}
        onClick={handleStageClick}
        className={`relative w-full h-[540px] overflow-hidden ${
          mouseFree || isEditing ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        {layout.controls.map((ctrl) => {
          const sig = getBindingSignature(ctrl.binding);
          const isSelected = ctrl.id === selectedControlId;
          return (
            <div
              key={ctrl.id}
              onPointerDown={(e) => {
                if (!isEditing) return;
                e.stopPropagation();
                setSelectedControlId(ctrl.id);
                setDraggingId(ctrl.id);
              }}
              style={{
                left: `${ctrl.xNorm * 100}%`,
                top: `${ctrl.yNorm * 100}%`,
              }}
              className={`-translate-x-1/2 -translate-y-1/2 absolute px-2.5 py-1.5 rounded-full text-xs font-bold border shadow cursor-grab active:cursor-grabbing ${
                isSelected
                  ? "bg-indigo-600/90 border-white text-white ring-2 ring-indigo-300"
                  : "bg-zinc-950/80 border-emerald-400/80 text-emerald-300"
              }`}
            >
              <span>{ctrl.kind === "joystick" ? "WASD" : ctrl.kind === "aim_pan" ? "AIM" : sig}</span>
              {ctrl.kind === "macro" && <span className="ml-1 text-[10px] opacity-80">[M]</span>}
            </div>
          );
        })}

        {mouseFree && (
          <button
            type="button"
            onClick={() => setFreeMouseState(false)}
            aria-label="Lock mouse to aim"
            className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-red-600 text-white font-bold shadow"
          >
            X
          </button>
        )}
      </div>

      {isEditing && (
        <div className="p-3 bg-zinc-900 border-t border-zinc-800 text-xs text-zinc-200 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => addControl("tap")}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
            >
              + Tap Key
            </button>
            <button
              type="button"
              onClick={() => addControl("joystick")}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
            >
              + Joystick
            </button>
            <button
              type="button"
              onClick={() => addControl("aim_pan")}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
            >
              + Aim Area
            </button>
            <button
              type="button"
              onClick={() => addControl("macro")}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
            >
              + Macro
            </button>
            <button
              type="button"
              onClick={() => addControl("free_mouse")}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
            >
              + Free/Aim Toggle
            </button>
            {statusMsg && <span className="text-emerald-400">{statusMsg}</span>}
          </div>

          {selectedControl && (
            <div className="p-2.5 rounded bg-zinc-950 border border-zinc-800 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Key:</span>
                <input
                  type="text"
                  value={selectedControl.binding.key}
                  onChange={(e) =>
                    onUpdateLayout({
                      ...layout,
                      controls: layout.controls.map((c) =>
                        c.id === selectedControl.id
                          ? {
                              ...c,
                              binding: {
                                ...c.binding,
                                key: normalizeKeyName(e.target.value) || "A",
                              },
                            }
                          : c
                      ),
                    })
                  }
                  className="w-20 px-2 py-1 rounded bg-zinc-800 border border-zinc-700"
                />

                {ALL_MODIFIERS.map((mod) => {
                  const active = selectedControl.binding.modifiers.includes(mod);
                  return (
                    <button
                      key={mod}
                      type="button"
                      onClick={() => toggleModifierOnSelected(mod)}
                      className={`px-2 py-1 rounded ${
                        active ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {mod}
                    </button>
                  );
                })}
              </div>

              {selectedControl.kind === "macro" && selectedControl.macro && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={macroSequenceTarget}
                      onChange={(e) =>
                        setMacroSequenceTarget(e.target.value as "primary" | "secondary")
                      }
                      className="px-2 py-1 rounded bg-zinc-800 border border-zinc-700"
                    >
                      <option value="primary">Urutan 1 (Tekan Pertama)</option>
                      <option value="secondary">Urutan 2 (Tekan Berikutnya)</option>
                    </select>

                    <select
                      value={macroToolMode}
                      onChange={(e) => {
                        setMacroToolMode(e.target.value as "tap" | "swipe");
                        setPendingSwipeStart(null);
                      }}
                      className="px-2 py-1 rounded bg-zinc-800 border border-zinc-700"
                    >
                      <option value="tap">Mode Rekam: Tap</option>
                      <option value="swipe">Mode Rekam: Swipe (2 klik)</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => {
                        setIsRecordingMacro(!isRecordingMacro);
                        setPendingSwipeStart(null);
                      }}
                      className={`px-2.5 py-1 rounded ${
                        isRecordingMacro ? "bg-rose-600 text-white" : "bg-emerald-700 text-white"
                      }`}
                    >
                      {isRecordingMacro ? "Stop Rekam" : "Rekam di Layar"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        appendMacroStep({
                          id: `step_${Date.now()}`,
                          type: "wait",
                          durationMs: 150,
                        });
                        setStatusMsg("Ditambahkan jeda wait 150ms");
                      }}
                      className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
                    >
                      + Wait 150ms
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        appendMacroStep({
                          id: `step_${Date.now()}`,
                          type: "toggle_mouse",
                          mode: "toggle",
                        });
                        setStatusMsg("Ditambahkan step toggle mouse");
                      }}
                      className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
                    >
                      + Toggle Mouse
                    </button>
                  </div>

                  <div className="text-zinc-400">
                    Urutan 1: {selectedControl.macro.primarySteps.length} step | Urutan 2:{" "}
                    {selectedControl.macro.secondarySteps?.length ?? 0} step
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const code = encodeLayoutShareCode(layout);
                setShareCodeText(code);
                void navigator.clipboard?.writeText(code);
                setStatusMsg("Share code disalin ke clipboard");
              }}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
            >
              Generate Share Code
            </button>

            <input
              type="text"
              placeholder="Tempel share code di sini untuk import..."
              value={shareCodeText}
              onChange={(e) => setShareCodeText(e.target.value)}
              className="flex-1 min-w-[220px] px-2 py-1 rounded bg-zinc-800 border border-zinc-700"
            />

            <button
              type="button"
              onClick={() => {
                const parsed = decodeLayoutShareCode(shareCodeText);
                if (!parsed) {
                  setStatusMsg("Share code tidak valid");
                  return;
                }
                onImportLayout({
                  ...parsed,
                  id: `layout_${Date.now()}`,
                  number: allLayouts.length + 1,
                });
                setStatusMsg(`Layout "${parsed.name}" berhasil diimpor`);
              }}
              className="px-2.5 py-1 rounded bg-emerald-600 text-white"
            >
              Import
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
