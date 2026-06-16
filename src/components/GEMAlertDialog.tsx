/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface GEMAlertDialogProps {
  isOpen: boolean;
  type: 'info' | 'success' | 'warn' | 'confirm' | 'prompt';
  title: string;
  message: string | React.ReactNode;
  promptValue?: string;
  onPromptChange?: (val: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  okText?: string;
  cancelText?: string;
}

export default function GEMAlertDialog({
  isOpen,
  type,
  title,
  message,
  promptValue,
  onPromptChange,
  onConfirm,
  onCancel,
  okText = 'OK',
  cancelText = 'Cancel',
}: GEMAlertDialogProps) {
  if (!isOpen) return null;

  // Icons based on type
  let iconChar = '!';
  if (type === 'confirm' || type === 'prompt') iconChar = '?';
  if (type === 'success') iconChar = '✓';

  return (
    <div className="fixed inset-0 bg-black/40 z-[10000] flex items-center justify-center animate-fade-in p-4">
      <div className="bg-white p-1 gem-double-border w-full max-w-[380px]">
        <div className="border border-black p-4 space-y-4 text-center bg-white">
          <div className="flex items-center justify-center space-x-3">
            <div className="w-8 h-8 shrink-0 border-2 border-black flex items-center justify-center font-extrabold text-lg bg-black text-white">
              {iconChar}
            </div>
            <span className="font-bold uppercase tracking-widest text-gem-small text-left w-full truncate">
              {title || 'SYSTEM DIALOG'}
            </span>
          </div>
          
          <p className="text-gem-normal font-bold leading-relaxed px-2 text-left bg-gray-50 p-2 border border-black whitespace-pre-wrap font-mono max-h-[160px] overflow-y-auto">
            {message}
          </p>

          {type === 'prompt' && onPromptChange && (
            <input
              type="text"
              value={promptValue || ''}
              onChange={(e) => onPromptChange(e.target.value)}
              className="w-full bg-white border border-black px-2 py-1 text-gem-normal font-mono text-black uppercase outline-none"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') onConfirm();
                if (e.key === 'Escape') onCancel();
              }}
            />
          )}

          <div className="flex justify-center gap-4 pt-1">
            <button
              onClick={onConfirm}
              className="gem-btn text-gem-normal px-6 py-1 min-w-[100px] cursor-pointer"
            >
              {okText}
            </button>
            {(type === 'confirm' || type === 'prompt') && (
              <button
                onClick={onCancel}
                className="gem-btn text-gem-normal px-6 py-1 min-w-[100px] cursor-pointer"
              >
                {cancelText}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
