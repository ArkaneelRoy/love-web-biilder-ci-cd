/**
 * ============================================================================
 * player.js — Emscripten Module Configuration & Virtual FS Mounter
 * ============================================================================
 *
 * HOW LÖVE BOOTS IN WEBASSEMBLY:
 * 1. Emscripten looks for a global `window.Module` object when `love.js` loads.
 * 2. Setting `arguments: ['/game.love']` instructs LÖVE's C++ entry point and
 *    `boot.lua` to mount `/game.love` via PhysFS.
 * 3. Inside `Module.preRun`, Emscripten's virtual filesystem is initialized
 *    but C++ `main()` has not run yet—making it the exact right moment to
 *    write our received .love bytes to `/game.love` via `FS_createDataFile()`.
 */

(function () {
  'use strict';

  // Forward uncaught runtime or promise errors back to the parent console
  window.addEventListener('error', (e) => {
    window.parent.postMessage({
      type: 'DEBUG_LOG',
      level: 'err',
      text: `${e.message} (${e.filename}:${e.lineno})`
    }, '*');
  });

  window.addEventListener('unhandledrejection', (e) => {
    window.parent.postMessage({
      type: 'DEBUG_LOG',
      level: 'err',
      text: `Unhandled Promise: ${e.reason}`
    }, '*');
  });

  // Listen for the transferred .love ArrayBuffer from app.js
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'RUN_LOVE') return;

    const canvas = document.getElementById('canvas');
    canvas.focus();

    // 1. Configure Emscripten Module BEFORE dynamically loading love.js
    window.Module = {
      canvas: canvas,
      arguments: ['/game.love'],

      // Pipe Lua print() statements to parent Serial output
      print: (msg) => {
        window.parent.postMessage({ type: 'LOVE_LOG', level: 'info', msg }, '*');
      },

      // Pipe Lua/SDL/OpenAL errors to parent Serial output
      printErr: (msg) => {
        window.parent.postMessage({ type: 'LOVE_LOG', level: 'error', msg }, '*');
      },

      // 2. Mount the in-memory .love ZIP archive into Emscripten's root FS
      preRun: [
        function (mod) {
          const target = mod || window.Module;
          target.FS_createDataFile(
            '/',                                    // Parent directory
            'game.love',                            // Virtual filename
            new Uint8Array(event.data.zipBuffer),   // Raw ZIP file bytes
            true,                                   // canRead
            true,                                   // canWrite
            true                                    // canOwn
          );
        }
      ]
    };

    // 3. Inject the single-file love.js runtime now that window.Module is ready
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/gh/ArkaneelRoy/love.js@main/love.js';

   script.onload = async () => {
      // Support both MODULARIZE=1 factory builds (`Love(Module)`) and global builds
      if (typeof Love === 'function') {
        await Love(window.Module);
      } else if (typeof Module === 'function') {
        await Module(window.Module);
      }
    };

    script.onerror = () => {
      window.parent.postMessage({
        type: 'DEBUG_LOG',
        level: 'err',
        text: 'Failed to load love.js. Ensure love.js is in the same folder as player.html.'
      }, '*');
    };

    document.body.appendChild(script);
  });
})();
