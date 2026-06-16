import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Safe Performance.measure wrapper to prevent React 19 / Fiber cloning crashes on Chromium
if (typeof window !== 'undefined' && window.performance && typeof window.performance.measure === 'function') {
  const originalMeasure = window.performance.measure;
  window.performance.measure = function (name, startMarkOrOptions, endMark) {
    try {
      if (startMarkOrOptions && typeof startMarkOrOptions === 'object') {
        const isFiber = 'tag' in startMarkOrOptions && 'stateNode' in startMarkOrOptions;
        if (isFiber) {
          // It's a React Fiber! Do not pass it to measure because the browser will 
          // attempt structured clone on it as measure options, causing uncaught DataCloneError.
          return originalMeasure.call(this, name);
        }
      }
      return originalMeasure.call(this, name, startMarkOrOptions, endMark);
    } catch (e) {
      try {
        // Safe fallback in case of any cloning / parameter matching issues
        return originalMeasure.call(this, name);
      } catch (err) {
        // Do nothing if even fallback fails
      }
    }
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
