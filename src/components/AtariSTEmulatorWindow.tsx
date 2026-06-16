/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import GEMSkeletalWindow from './GEMSkeletalWindow';

interface AtariSTEmulatorWindowProps {
  isOpen: boolean;
  onClose: () => void;
  activeId: string;
  onFocus: () => void;
  mobileMode?: boolean;
  diskBytes: Uint8Array | null;
  diskName: string;
  showToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

export default function AtariSTEmulatorWindow({
  isOpen,
  onClose,
  activeId,
  onFocus,
  mobileMode,
  diskBytes,
  diskName,
  showToast,
}: AtariSTEmulatorWindowProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [emuStatus, setEmuStatus] = useState<'idle' | 'loading' | 'running' | 'paused'>('idle');

  // Convert Uint8Array to Base64 for posting to iframe
  const getDiskBase64 = () => {
    if (!diskBytes) return '';
    let binary = '';
    const len = diskBytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(diskBytes[i]);
    }
    return window.btoa(binary);
  };

  // Synchronize or boot floppy when iframe loads or diskBytes change
  const handleLoadFloppy = () => {
    if (!diskBytes || !iframeRef.current || !iframeRef.current.contentWindow) return;
    try {
      setEmuStatus('loading');
      const base64Data = getDiskBase64();
      iframeRef.current.contentWindow.postMessage(
        {
          type: 'load_floppy',
          base64: base64Data,
        },
        '*'
      );
      setTimeout(() => setEmuStatus('running'), 1500);
    } catch (e: any) {
      showToast(`Emulator failed loading floppy: ${e.message}`, 'error');
    }
  };

  useEffect(() => {
    const handleIframeSignal = (event: MessageEvent) => {
      if (event.data && event.data.type === 'emu_ready') {
        handleLoadFloppy();
      } else if (event.data && event.data.type === 'emu_screenshot') {
        try {
          const link = document.createElement('a');
          const cleanDiskName = diskName ? diskName.replace(/\.[^/.]+$/, "") : "atari_st";
          link.download = `${cleanDiskName}_screenshot_${Date.now()}.png`;
          link.href = event.data.dataUrl;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          showToast('Screenshot downloaded successfully!', 'success');
        } catch (err: any) {
          showToast(`Failed to download screenshot: ${err.message}`, 'error');
        }
      } else if (event.data && event.data.type === 'emu_screenshot_error') {
        showToast(`Screenshot failed: ${event.data.error}`, 'error');
      }
    };
    window.addEventListener('message', handleIframeSignal);

    // Fallback timer if event gets missed/delayed
    const timer = setTimeout(() => {
      handleLoadFloppy();
    }, 1200);

    return () => {
      window.removeEventListener('message', handleIframeSignal);
      clearTimeout(timer);
    };
  }, [isOpen, diskBytes, diskName]);

  // Keyboard router from host window to within the sandboxed iframe
  useEffect(() => {
    if (!isOpen || activeId !== 'emulator') return;

    const handleHostKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      
      // Prevent browser default actions like arrow scrolling, space, backspace.
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace', 'Tab'].includes(e.key) || e.keyCode === 32) {
        e.preventDefault();
      }

      if (iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'host_keydown',
          keyCode: e.keyCode
        }, '*');
      }
    };

    const handleHostKeyUp = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'host_keyup',
          keyCode: e.keyCode
        }, '*');
      }
    };

    window.addEventListener('keydown', handleHostKeyDown, { capture: true });
    window.addEventListener('keyup', handleHostKeyUp, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleHostKeyDown, { capture: true });
      window.removeEventListener('keyup', handleHostKeyUp, { capture: true });
    };
  }, [isOpen, activeId]);

  const handleWarmReset = () => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'control', action: 'reset' }, '*');
      showToast('Atari ST warm reset triggered.', 'info');
    }
  };

  const handlePowerCycle = () => {
    handleLoadFloppy();
    showToast('Atari ST cold reboot triggered.', 'success');
  };

  const handleTakeScreenshot = () => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'take_screenshot' }, '*');
      showToast('Capturing screen from emulator...', 'info');
    } else {
      showToast('Emulator not ready for screenshot.', 'error');
    }
  };

  const iframeSrcDoc = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      background-color: #0b0f0b;
      color: #4af626;
      font-family: "Courier New", Courier, monospace;
      margin: 0;
      padding: 10px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      box-sizing: border-box;
    }
    #screen-container {
      position: relative;
      border: 8px solid #333;
      border-radius: 12px;
      box-shadow: 0 0 30px rgba(0,255,0,0.15), inset 0 0 20px rgba(0,0,0,0.9);
      background-color: #000;
      width: 640px;
      height: 400px;
      overflow: hidden;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      image-rendering: -moz-crisp-edges;
      image-rendering: -webkit-crisp-edges;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
      background-color: #000;
    }
    #status {
      margin-top: 10px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      text-align: center;
      font-weight: bold;
    }
    .loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(5,15,5,0.96);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 100;
      padding: 20px;
    }
    .spinner {
      margin-top: 15px;
      width: 40px;
      height: 12px;
      background: repeating-linear-gradient(90deg, #4af626 0px, #4af626 4px, transparent 4px, transparent 8px);
      animation: spin 1s infinite linear;
    }
    @keyframes spin {
      0% { background-position: 0px 0; }
      100% { background-position: 24px 0; }
    }
  </style>
  <script src="/estyjs/estyjs.js"></script>
  <script src="/estyjs/processor.js"></script>
  <script src="/estyjs/keyboard.js"></script>
  <script src="/estyjs/mfp.js"></script>
  <script src="/estyjs/fdc.js"></script>
  <script src="/estyjs/io.js"></script>
  <script src="/estyjs/bug.js"></script>
  <script src="/estyjs/display.js"></script>
  <script src="/estyjs/memory.js"></script>
  <script src="/estyjs/snapshot.js"></script>
  <script src="/estyjs/sound.js"></script>
  <script src="/estyjs/files.js"></script>
  <script src="/estyjs/js-unzip.js"></script>
  <script src="/estyjs/rawinflate.js"></script>
</head>
<body>
  <div id="screen-container">
    <div id="loading" class="loading-overlay">
      <div style="font-size: 18px; font-weight: bold; tracking-widest">[ SYSTEM DIAGNOSTICS ]</div>
      <div id="loading-msg" style="margin-top: 15px; font-size: 12px;">Pre-fetching OS firmware...</div>
      <div class="spinner"></div>
      <div style="font-size: 9px; margin-top: 25px; color: #447744;">EMULATION LAYER: EstyJS 2.0</div>
    </div>
    <canvas id="video" width="640" height="400"></canvas>
  </div>
  <div id="status">INIT STATE REGISTER ACQUIRED</div>

  <script>
    window.onerror = function(msg, url, line) {
      var err = "FATAL: " + msg + " (line " + line + ")";
      var statusEl = document.getElementById('status');
      if (statusEl) {
        statusEl.innerText = err;
        statusEl.style.color = "#ff3333";
      }
      var loadEl = document.getElementById('loading-msg');
      if (loadEl) {
        loadEl.innerText = err;
        loadEl.style.color = "#ff3333";
      }
      return false;
    };

    window.addEventListener('unhandledrejection', function(event) {
      var err = "UNHANDLED PROMISE: " + event.reason;
      var statusEl = document.getElementById('status');
      if (statusEl) {
        statusEl.innerText = err;
        statusEl.style.color = "#ff3333";
      }
    });

    (function() {
      var origError = console.error;
      console.error = function() {
        var msg = Array.prototype.slice.call(arguments).join(' ');
        var statusEl = document.getElementById('status');
        if (statusEl && msg && !msg.includes('CORS') && !msg.includes('WebSocket')) {
          statusEl.innerText = "SYS-ERR: " + msg.substring(0, 80);
          statusEl.style.color = "#ffdd33";
        }
        origError.apply(console, arguments);
      };
    })();

    var estyjs = null;
    var floppyBytes = null;

    function initAtariST() {
      try {
        var statusMsg = document.getElementById('loading-msg');
        statusMsg.innerText = "Initializing EstyJS engine...";
        
        estyjs = EstyJs("video");
        estyjs.setRowSkip(false);
        estyjs.setMonoMonitor(false);
        
        var localRoms = ['/etos256us.img', '/etos256uk.img', '/emutos.img'];
        var currentRomIndex = 0;
        
        function tryNextRom() {
          if (currentRomIndex < localRoms.length) {
            var url = localRoms[currentRomIndex];
            statusMsg.innerText = "Checking local workspace for " + url + "...";
            currentRomIndex++;
            
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = 'arraybuffer';
            xhr.onload = function(e) {
              if (this.status === 200) {
                var romBytes = new Uint8Array(this.response);
                statusMsg.innerText = "Success: Local ROM loaded [" + url + "]";
                var file = new File([romBytes], "tos.img", { type: 'application/octet-stream' });
                estyjs.changeTOS(file);
                setupFinish();
              } else {
                tryNextRom();
              }
            };
            xhr.onerror = function() {
              tryNextRom();
            };
            xhr.send();
          } else {
            // Fallback to CDN EmuTOS
            statusMsg.innerText = "Local ROM not found. Fetching online EmuTOS...";
            var xhr = new XMLHttpRequest();
            xhr.open('GET', 'https://kaiec.github.io/EstyJS/etos256us.img', true);
            xhr.responseType = 'arraybuffer';
            xhr.onload = function(e) {
              if (this.status === 200) {
                var romBytes = new Uint8Array(this.response);
                statusMsg.innerText = "EmuTOS loaded from remote. Booting kernel...";
                var file = new File([romBytes], "tos.img", { type: 'application/octet-stream' });
                estyjs.changeTOS(file);
                setupFinish();
              } else {
                statusMsg.innerText = "ROM loader failed. Please verify network access.";
                statusMsg.style.color = "red";
              }
            };
            xhr.onerror = function() {
              statusMsg.innerText = "Network Error loading ROM. CORS restriction or offline mode.";
              statusMsg.style.color = "red";
            };
            xhr.send();
          }
        }
        
        tryNextRom();
      } catch (err) {
        document.getElementById('loading-msg').innerText = "VCORE ERROR: " + err.message;
      }
    }

    function setupFinish() {
      document.getElementById('loading-msg').innerText = "ROM loaded. Waiting for floppy image...";
      tryBoot();
    }

    function tryBoot() {
      if (estyjs && floppyBytes) {
        document.getElementById('loading-msg').innerText = "Mounting disk in Drive A: ...";
        setTimeout(function() {
          try {
            var file = new File([floppyBytes], "floppy.st", { type: 'application/octet-stream' });
            estyjs.openFloppyFile('A', file);
            estyjs.reset();
            document.getElementById('loading').style.display = 'none';
            document.getElementById('status').innerText = "BOOT ACTIVE | DRIVE A: ONLINE | TAP FOR CONTROLS";
          } catch(e) {
            document.getElementById('loading-msg').innerText = "BOOT FAULT: " + e.message;
            document.getElementById('loading-msg').style.color = "red";
          }
        }, 500);
      }
    }

    window.addEventListener('message', function(event) {
      if (event.data && event.data.type === 'load_floppy') {
        var binary = window.atob(event.data.base64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        floppyBytes = bytes;
        if (estyjs) {
          var file = new File([floppyBytes], "floppy.st", { type: 'application/octet-stream' });
          estyjs.openFloppyFile('A', file);
          estyjs.reset();
          document.getElementById('loading').style.display = 'none';
          document.getElementById('status').innerText = "BOOT ACTIVE | DRIVE A: ONLINE | TAP FOR CONTROLS";
        } else {
          tryBoot();
        }
      } else if (event.data && event.data.type === 'control') {
        if (estyjs) {
          if (event.data.action === 'reset') {
            estyjs.reset();
          }
        }
      } else if (event.data && event.data.type === 'take_screenshot') {
        try {
          var canvas = document.getElementById('video');
          if (canvas) {
            var dataUrl = canvas.toDataURL('image/png');
            window.parent.postMessage({ type: 'emu_screenshot', dataUrl: dataUrl }, '*');
          } else {
            window.parent.postMessage({ type: 'emu_screenshot_error', error: 'Video canvas element not found' }, '*');
          }
        } catch (e) {
          window.parent.postMessage({ type: 'emu_screenshot_error', error: e.message || 'Unknown Canvas export error' }, '*');
        }
      } else if (event.data && event.data.type === 'host_keydown') {
        if (typeof document.onkeydown === 'function') {
          document.onkeydown({
            keyCode: event.data.keyCode,
            metaKey: false,
            preventDefault: function() {}
          });
        }
      } else if (event.data && event.data.type === 'host_keyup') {
        if (typeof document.onkeyup === 'function') {
          document.onkeyup({
            keyCode: event.data.keyCode,
            metaKey: false,
            preventDefault: function() {}
          });
        }
      }
    });

    window.parent.postMessage({ type: 'emu_ready' }, '*');
    setTimeout(initAtariST, 400);
  </script>
</body>
</html>
`;

  if (!isOpen) return null;

  return (
    <GEMSkeletalWindow
      id="emulator"
      title={`Atari ST Emulator - Boot [${diskName}]`}
      isOpen={isOpen}
      onClose={onClose}
      defaultX={80}
      defaultY={80}
      width={680}
      activeId={activeId}
      onFocus={onFocus}
    >
      <div className="p-3 bg-white space-y-3 font-sans no-drag flex-grow flex flex-col min-h-0">
        {/* Top Control Panel */}
        <div className="flex items-center justify-between border-b-2 border-black pb-2 select-none">
          <div className="flex items-center space-x-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse border border-black" />
            <span className="text-gem-small font-bold text-gray-800 uppercase tracking-tight">Atari ST Emulator (EstyJS)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleTakeScreenshot}
              className="gem-btn text-gem-tiny py-1 px-2.5 bg-emerald-50 hover:bg-emerald-500 hover:text-white transition-colors uppercase font-mono cursor-pointer"
              title="Take a high-quality png screenshot of the emulator screen"
            >
              TAKE SCREENSHOT
            </button>
            <button
              onClick={handleWarmReset}
              className="gem-btn text-gem-tiny py-1 px-2.5 hover:bg-black hover:text-white transition-colors uppercase font-mono cursor-pointer"
              title="Warm Boot (Resets without clearing memory)"
            >
              WARM RESET
            </button>
            <button
              onClick={handlePowerCycle}
              className="gem-btn text-gem-tiny py-1 px-2.5 bg-red-50 hover:bg-red-500 hover:text-white transition-colors uppercase font-mono cursor-pointer"
              title="Cold Boot (Reloads Floppy and powers on)"
            >
              COLD BOOT
            </button>
          </div>
        </div>

        {/* Dynamic Emulator Content Stage */}
        <div 
          onClick={() => {
            iframeRef.current?.focus();
            onFocus();
          }}
          className="bg-black relative rounded border border-black p-1 flex-grow flex items-center justify-center overflow-hidden cursor-pointer"
        >
          <iframe
            ref={iframeRef}
            srcDoc={iframeSrcDoc}
            className="w-full h-full border-none max-w-[660px] aspect-[8/5]"
            title="EstyJS Simulator"
            sandbox="allow-scripts allow-same-origin allow-modals"
            onLoad={handleLoadFloppy}
          />
        </div>
      </div>
    </GEMSkeletalWindow>
  );
}
