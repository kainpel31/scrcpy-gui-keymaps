import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { VisualKeymapOverlay } from './components/VisualKeymapOverlay';
import {
  GameLayout,
  TouchDispatchPayload,
  createDefaultLayouts,
} from './types/keymap';

export default function App() {
  const [layouts, setLayouts] = useState<GameLayout[]>(() => createDefaultLayouts());
  const [activeLayoutId, setActiveLayoutId] = useState<string>('layout_1');
  const [isEditing, setIsEditing] = useState<boolean>(false);

  const activeLayout = layouts.find((l) => l.id === activeLayoutId) ?? layouts[0];

  const handleUpdateLayout = (updated: GameLayout) => {
    setLayouts((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
  };

  const handleImportLayout = (imported: GameLayout) => {
    setLayouts((prev) => [...prev, imported]);
    setActiveLayoutId(imported.id);
  };

  const handleDispatchTouch = async (payload: TouchDispatchPayload) => {
    try {
      await invoke('inject_android_touch', {
        serial: null,
        action: payload.action,
        x: payload.x,
        y: payload.y,
        toX: payload.toX ?? null,
        toY: payload.toY ?? null,
        durationMs: payload.durationMs ?? null,
      });
    } catch (err) {
      console.error('Touch dispatch failed:', err);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4">
      <div className="max-w-5xl mx-auto rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900">
        <VisualKeymapOverlay
          layout={activeLayout}
          allLayouts={layouts}
          deviceWidth={1920}
          deviceHeight={1080}
          isEditing={isEditing}
          onToggleEdit={() => setIsEditing((v) => !v)}
          onSelectLayout={setActiveLayoutId}
          onUpdateLayout={handleUpdateLayout}
          onImportLayout={handleImportLayout}
          onDispatchTouch={handleDispatchTouch}
        />
      </div>
    </div>
  );
}
