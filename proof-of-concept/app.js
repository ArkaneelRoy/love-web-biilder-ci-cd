/**
 * ============================================================================
 * app.js — Host IDE Controller, Lua Syntax Highlighter & Iframe Manager
 * ============================================================================
 *
 * RESPONSIBILITIES:
 * 1. Syncs the transparent <textarea> with the syntax-highlighted <pre> layer.
 * 2. Packages `main.lua` into a .love ArrayBuffer via `createLoveZip()`.
 * 3. Destroys and recreates `player.html` inside `#frameContainer` on every run
 *    so Emscripten gets a clean memory heap and WebGL context.
 * 4. Transfers the .love ArrayBuffer into the iframe using zero-copy
 *    `postMessage` Transferables and displays forwarded Lua/WASM logs.
 */

(function () {
  'use strict';

  // DOM References
  const codeArea       = document.getElementById('code');
  const highlightLayer = document.getElementById('highlightLayer');
  const highlightCode  = document.getElementById('highlightCode');
  const consoleOut     = document.getElementById('consoleOutput');
  const docsPanel      = document.getElementById('docsPanel');
  const serialDock     = document.getElementById('serialDock');
  const tabConsole     = document.getElementById('tabConsole');
  const tabDocs        = document.getElementById('tabDocs');

  /* --------------------------------------------------------------------------
     1. SERIAL CONSOLE & DOCK TABS
     -------------------------------------------------------------------------- */

  function appendLog(tag, message) {
    consoleOut.textContent += `\n> [${tag.toUpperCase()}] ${message}`;
    consoleOut.scrollTop = consoleOut.scrollHeight;
  }

  tabConsole.addEventListener('click', () => {
    tabConsole.classList.add('active');
    tabDocs.classList.remove('active');
    consoleOut.style.display = 'block';
    docsPanel.style.display = 'none';
    serialDock.classList.remove('minimized');
  });

  tabDocs.addEventListener('click', () => {
    tabDocs.classList.add('active');
    tabConsole.classList.remove('active');
    consoleOut.style.display = 'none';
    docsPanel.style.display = 'block';
    serialDock.classList.remove('minimized');
  });

  document.getElementById('toggleDockBtn').addEventListener('click', () => {
    serialDock.classList.toggle('minimized');
  });

  document.getElementById('clearLogBtn').addEventListener('click', () => {
    consoleOut.textContent = 'READY.';
  });

  /* --------------------------------------------------------------------------
     2. SINGLE-PASS LUA SYNTAX HIGHLIGHTER (TAPIOCA PALETTE)
     -------------------------------------------------------------------------- */

  function highlightLua(src) {
    // Escape HTML entities before injecting <span> tags
    const escaped = src
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Match in priority order: Comments -> Strings -> Keywords -> love.* -> Functions -> Numbers
    const tokenRegex = /(--[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(local|function|end|if|then|else|elseif|for|while|do|repeat|until|in|return|break|and|or|not|nil|true|false)\b|\b(love(?:\.[a-zA-Z_]\w*)*)\b|\b([a-zA-Z_]\w*)(?=\s*\()|\b(\d+(?:\.\d+)?)\b/g;

    const highlighted = escaped.replace(tokenRegex, (match, comment, str, kw, loveApi, fn, num) => {
      if (comment) return `<span class="tok-comment">${comment}</span>`;
      if (str)     return `<span class="tok-string">${str}</span>`;
      if (kw)      return `<span class="tok-keyword">${kw}</span>`;
      if (loveApi) return `<span class="tok-love">${loveApi}</span>`;
      if (fn)      return `<span class="tok-func">${fn}</span>`;
      if (num)     return `<span class="tok-number">${num}</span>`;
      return match;
    });

    // Trailing space ensures final blank lines match textarea scroll height
    return highlighted + (src.endsWith('\n') ? ' ' : '');
  }

  function syncEditor() {
    highlightCode.innerHTML = highlightLua(codeArea.value);
  }

  codeArea.addEventListener('input', syncEditor);

  // Lock scroll positions between the editable textarea and backdrop layer
  codeArea.addEventListener('scroll', () => {
    highlightLayer.scrollTop = codeArea.scrollTop;
    highlightLayer.scrollLeft = codeArea.scrollLeft;
  });

  // Insert 2 spaces on Tab key press instead of losing focus
  codeArea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = codeArea.selectionStart;
      const end = codeArea.selectionEnd;
      codeArea.value = codeArea.value.substring(0, start) + '  ' + codeArea.value.substring(end);
      codeArea.selectionStart = codeArea.selectionEnd = start + 2;
      syncEditor();
    }
  });

  /* --------------------------------------------------------------------------
     3. SANDBOXED IFRAME BOOT & IPC MESSAGE LISTENER
     -------------------------------------------------------------------------- */

  // Receive stdout/stderr logs forwarded from inside player.html
  window.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'LOVE_LOG') {
      appendLog(event.data.level === 'error' ? 'err' : 'out', event.data.msg);
    } else if (event.data.type === 'DEBUG_LOG') {
      appendLog(event.data.level, event.data.text);
    }
  });

  /**
   * Packages the current Lua code into a .love buffer and boots a fresh iframe.
   */
  function bootCartridge() {
    try {
      consoleOut.textContent = '> [CART] Packing main.lua...';

      // Step 1: Build binary .love archive in memory
      const zipBuffer = window.createLoveZip({ 'main.lua': codeArea.value });
      appendLog('cart', `Packed ${zipBuffer.byteLength}B -> /game.love`);

      // Step 2: Destroy old iframe to wipe previous WebGL context & WASM memory
      const container = document.getElementById('frameContainer');
      container.innerHTML = '';

      const iframe = document.createElement('iframe');
      iframe.src = 'player.html';

      // Step 3: Transfer ownership of zipBuffer once player.html is listening
      iframe.onload = () => {
        appendLog('wasm', 'Booting LÖVE 12.0...');
        iframe.contentWindow.postMessage({ type: 'RUN_LOVE', zipBuffer }, '*', [zipBuffer]);
      };

      container.appendChild(iframe);
    } catch (err) {
      appendLog('err', err.message);
    }
  }

  document.getElementById('runBtn').addEventListener('click', bootCartridge);

  // Initialize syntax colors and auto-boot the default cart on page load
  window.addEventListener('DOMContentLoaded', () => {
    syncEditor();
    bootCartridge();
  });
})();
    
