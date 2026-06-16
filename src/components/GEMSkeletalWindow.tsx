/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';

interface GEMSkeletalWindowProps {
  id: string;
  title: string;
  isOpen: boolean;
  onClose: () => void;
  defaultX: number;
  defaultY: number;
  width: number;
  height?: number | string; // Pass 'auto' or a number of pixels
  activeId: string | null;
  onFocus: () => void;
  children: React.ReactNode;
  mobileMode?: boolean;
}

export default function GEMSkeletalWindow({
  id,
  title,
  isOpen,
  onClose,
  defaultX,
  defaultY,
  width,
  height = 'auto',
  activeId,
  onFocus,
  children,
  mobileMode,
}: GEMSkeletalWindowProps) {
  const [pos, setPos] = useState({ x: defaultX, y: defaultY });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const posStartRef = useRef({ x: defaultX, y: defaultY });

  // Sizing and maximization states
  const [size, setSize] = useState<{ width: number; height: number | string }>({
    width: width,
    height: height,
  });
  const [isMaximized, setIsMaximized] = useState(false);
  const windowRef = useRef<HTMLDivElement | null>(null);
  const resizeStartRef = useRef({ width: 0, height: 0, clientX: 0, clientY: 0 });

  // Mobile Mode listener & responsive state
  const [localMobile, setLocalMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const glob = (window as any).GEM_MOBILE_OVERRIDE;
      if (glob !== undefined) {
        setLocalMobile(glob);
      } else {
        setLocalMobile(window.innerWidth < 768);
      }
    };

    const handleOverrideChange = (e: Event) => {
      const customEvt = e as CustomEvent;
      if (customEvt.detail && typeof customEvt.detail.mobileMode === 'boolean') {
        setLocalMobile(customEvt.detail.mobileMode);
      }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('gem-mobile-toggle', handleOverrideChange);

    // Initial check
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('gem-mobile-toggle', handleOverrideChange);
    };
  }, []);

  const isMobile = mobileMode !== undefined ? mobileMode : localMobile;

  // Auto-maximize on mobile when opened or active
  useEffect(() => {
    if (isMobile && isOpen) {
      setIsMaximized(true);
    }
  }, [isMobile, isOpen]);

  // Sync state if initial width or height props update
  useEffect(() => {
    setSize({
      width: width,
      height: height,
    });
  }, [width, height]);

  // Clean up global listeners on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousemove', handleResizeMouseMove);
      document.removeEventListener('mouseup', handleResizeMouseUp);
    };
  }, []);

  // Update position if screen dimensions require it
  useEffect(() => {
    // Keep within bounds
    if (pos.x < 0 || pos.y < 32) {
      setPos({
        x: Math.max(0, pos.x),
        y: Math.max(32, pos.y),
      });
    }
  }, [pos]);

  if (!isOpen) return null;

  const handleMouseDown = (e: React.MouseEvent) => {
    onFocus();

    // Disable dragging if minimized or maximized
    if (isMaximized) return;

    // Check if clicking close button, search inputs or buttons
    const target = e.target as HTMLElement;
    if (
      target.closest('.no-drag') ||
      target.tagName === 'BUTTON' ||
      target.tagName === 'INPUT'
    ) {
      return;
    }

    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    posStartRef.current = { ...pos };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  function handleMouseMove(e: MouseEvent) {
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    
    let nextX = posStartRef.current.x + dx;
    let nextY = posStartRef.current.y + dy;

    // Constrain within reason
    nextX = Math.max(0, Math.min(window.innerWidth - 80, nextX));
    nextY = Math.max(32, Math.min(window.innerHeight - 80, nextY));

    setPos({ x: nextX, y: nextY });
  }

  function handleMouseUp() {
    setIsDragging(false);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }

  // Resize Handlers
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onFocus();

    if (isMaximized) return;

    const currentWidth = windowRef.current ? windowRef.current.offsetWidth : (typeof size.width === 'number' ? size.width : 560);
    const currentHeight = windowRef.current ? windowRef.current.offsetHeight : (typeof size.height === 'number' ? size.height : 500);

    resizeStartRef.current = {
      width: currentWidth,
      height: currentHeight,
      clientX: e.clientX,
      clientY: e.clientY
    };

    document.addEventListener('mousemove', handleResizeMouseMove);
    document.addEventListener('mouseup', handleResizeMouseUp);
  };

  function handleResizeMouseMove(e: MouseEvent) {
    const dx = e.clientX - resizeStartRef.current.clientX;
    const dy = e.clientY - resizeStartRef.current.clientY;

    const newWidth = Math.max(320, resizeStartRef.current.width + dx);
    const newHeight = Math.max(180, resizeStartRef.current.height + dy);

    setSize({
      width: newWidth,
      height: newHeight
    });
  }

  function handleResizeMouseUp() {
    document.removeEventListener('mousemove', handleResizeMouseMove);
    document.removeEventListener('mouseup', handleResizeMouseUp);
  }

  const isActive = activeId === id;

  return (
    <div
      ref={windowRef}
      id={`win-${id}`}
      style={
        isMaximized
          ? {
              left: '0px',
              top: '0px',
              width: '100%',
              height: '100%',
            }
          : {
              left: `${pos.x}px`,
              top: `${pos.y}px`,
              width: `${size.width}px`,
              height: typeof size.height === 'number' ? `${size.height}px` : size.height,
            }
      }
      className={`absolute gem-window flex flex-col select-none animate-fade-in ${
        isActive ? 'z-40' : 'z-20'
      }`}
      onMouseDown={onFocus}
    >
      {/* Title Bar */}
      <div
        className="h-7 border-b-2 border-black flex items-center justify-between px-1.5 cursor-move"
        onMouseDown={handleMouseDown}
        onDoubleClick={() => setIsMaximized(prev => !prev)}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="no-drag w-4 h-4 bg-white border border-black flex items-center justify-center font-bold text-[10px] hover:bg-black hover:text-white"
        >
          ✕
        </button>
        <div className="flex-grow mx-2 h-4 gem-hatch flex items-center justify-center">
          <span className="bg-white px-2 py-0.5 font-bold text-[10px] sm:text-gem-normal border-x-2 border-black select-none truncate max-w-[160px] sm:max-w-none">
            {title}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsMaximized(prev => !prev);
          }}
          className="no-drag w-4 h-4 bg-white border border-black flex items-center justify-center font-bold text-[10px] hover:bg-black hover:text-white cursor-pointer"
          title={isMaximized ? "Restore Window" : "Maximize Window"}
        >
          {isMaximized ? '❐' : '▫'}
        </button>
      </div>

      {/* Main content body */}
      <div className="flex-grow flex flex-col bg-white overflow-hidden relative">
        {children}
      </div>

      {/* Resize Handle at the bottom-right corner */}
      {!isMaximized && (
        <div
          className="absolute bottom-0 right-0 w-3.5 h-3.5 cursor-se-resize flex items-end justify-end p-0.5 z-50 no-drag"
          onMouseDown={handleResizeMouseDown}
          title="Drag to resize"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" className="text-black opacity-60 hover:opacity-100 pointer-events-none">
            <line x1="0" y1="8" x2="8" y2="0" stroke="currentColor" strokeWidth="1.5" />
            <line x1="3" y1="8" x2="8" y2="3" stroke="currentColor" strokeWidth="1.5" />
            <line x1="6" y1="8" x2="8" y2="6" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </div>
      )}
    </div>
  );
}
