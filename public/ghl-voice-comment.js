/* =========================================================================
 * Kleegr — Voice note for GHL Internal Comments
 * -------------------------------------------------------------------------
 * Paste this into GHL Settings → Custom JS (after setting ENDPOINT below).
 *
 * What it does:
 *   - Adds a mic button to the conversation composer.
 *   - Records a voice note in the browser (MediaRecorder).
 *   - Sends the recording to the Vercel backend, which uploads the audio and
 *     posts it as an InternalComment on the open contact's conversation.
 *
 * It does NOT send anything to the contact — internal comment only.
 *
 * IMPORTANT: set ENDPOINT to your deployed Vercel URL + /api/internal-comment
 * and bump VERSION when you change this file (GHL caches custom JS hard).
 * ========================================================================= */
(function kleegrVoiceComment() {
  "use strict";

  // ---- CONFIG -------------------------------------------------------------
  var ENDPOINT = "https://REPLACE-WITH-YOUR-VERCEL-URL/api/internal-comment";
  var VERSION = 1;
  // -------------------------------------------------------------------------

  if (window.__kleegrVoiceCommentInstalled === VERSION) return;
  window.__kleegrVoiceCommentInstalled = VERSION;

  var recording = false;
  var mediaRecorder = null;
  var chunks = [];
  var timerInt = null;
  var startedAt = 0;

  // ---- helpers: resolve who we're commenting on ---------------------------
  function getConversationId() {
    var m = location.href.match(/conversations\/conversations\/([A-Za-z0-9]+)/);
    return m ? m[1] : "";
  }
  function getContactIdFromDom() {
    // GHL renders a link to the contact detail somewhere in the conversation UI.
    var a = document.querySelector('a[href*="/contacts/detail/"]');
    if (a) {
      var m = a.getAttribute("href").match(/\/contacts\/detail\/([A-Za-z0-9]+)/);
      if (m) return m[1];
    }
    return "";
  }
  function getUserId() {
    // Best-effort: GHL exposes the logged-in user id in a few places.
    try {
      if (window.__USER__ && window.__USER__.id) return window.__USER__.id;
    } catch (e) {}
    return "";
  }

  // ---- UI ------------------------------------------------------------------
  function makeButton() {
    var btn = document.createElement("button");
    btn.id = "kleegr-voice-btn";
    btn.type = "button";
    btn.title = "Record a voice note as an internal comment";
    btn.style.cssText = [
      "display:inline-flex", "align-items:center", "justify-content:center",
      "gap:6px", "height:36px", "padding:0 12px", "border-radius:9999px",
      "border:1px solid #e2e8f0", "background:#fff8e1", "color:#a16207",
      "font:600 13px system-ui,sans-serif", "cursor:pointer", "margin:4px",
      "box-shadow:0 1px 2px rgba(0,0,0,.06)"
    ].join(";");
    btn.innerHTML = micSvg() + '<span id="kleegr-voice-label">Voice note</span>';
    btn.addEventListener("click", onClick);
    return btn;
  }
  function micSvg() {
    return '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2Z"/></svg>';
  }
  function setLabel(text, color, bg) {
    var l = document.getElementById("kleegr-voice-label");
    var b = document.getElementById("kleegr-voice-btn");
    if (l) l.textContent = text;
    if (b && color) b.style.color = color;
    if (b && bg) b.style.background = bg;
  }

  // Floating fallback button (always available even if composer not found).
  function ensureFloatingButton() {
    if (document.getElementById("kleegr-voice-fab")) return;
    var fab = makeButton();
    fab.id = "kleegr-voice-fab";
    fab.style.position = "fixed";
    fab.style.right = "18px";
    fab.style.bottom = "18px";
    fab.style.zIndex = "99999";
    document.body.appendChild(fab);
  }

  // Try to place the button inside the conversation composer toolbar.
  function injectIntoComposer() {
    // Common GHL composer anchors — try a few; harmless if none match (the
    // floating button still works).
    var composer = document.querySelector(
      '.message-composer, .hl-text-editor, [class*="composer"], [class*="message-input"]'
    );
    if (composer && !composer.querySelector("#kleegr-voice-btn")) {
      composer.appendChild(makeButton());
    }
  }

  // ---- recording -----------------------------------------------------------
  function onClick() {
    if (recording) { stopRecording(); }
    else { startRecording(); }
  }

  function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Microphone not supported in this browser.");
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      chunks = [];
      var mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
      mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mediaRecorder.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        var blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
        send(blob);
      };
      mediaRecorder.start();
      recording = true;
      startedAt = Date.now();
      setLabel("0:00 · Stop", "#dc2626", "#fef2f2");
      timerInt = setInterval(function () {
        var s = Math.floor((Date.now() - startedAt) / 1000);
        setLabel((Math.floor(s / 60)) + ":" + String(s % 60).padStart(2, "0") + " · Stop", "#dc2626", "#fef2f2");
      }, 500);
    }).catch(function () {
      alert("Microphone permission denied.");
    });
  }

  function stopRecording() {
    recording = false;
    if (timerInt) { clearInterval(timerInt); timerInt = null; }
    setLabel("Sending…", "#2563eb", "#eff6ff");
    try { mediaRecorder && mediaRecorder.stop(); } catch (e) {}
  }

  function send(blob) {
    var conversationId = getConversationId();
    var contactId = getContactIdFromDom();
    if (!conversationId && !contactId) {
      setLabel("Open a chat first", "#dc2626", "#fef2f2");
      setTimeout(reset, 2500);
      return;
    }
    var fd = new FormData();
    fd.append("file", blob, "voice-note.webm");
    if (contactId) fd.append("contactId", contactId);
    if (conversationId) fd.append("conversationId", conversationId);
    var uid = getUserId();
    if (uid) fd.append("userId", uid);

    fetch(ENDPOINT, { method: "POST", body: fd })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.success) {
          setLabel("Posted ✓", "#15803d", "#f0fdf4");
        } else {
          setLabel("Failed", "#dc2626", "#fef2f2");
          console.error("[kleegr-voice] post failed:", j && j.error);
        }
        setTimeout(reset, 2500);
      })
      .catch(function (err) {
        setLabel("Failed", "#dc2626", "#fef2f2");
        console.error("[kleegr-voice] network error:", err);
        setTimeout(reset, 2500);
      });
  }

  function reset() {
    setLabel("Voice note", "#a16207", "#fff8e1");
  }

  // ---- boot ----------------------------------------------------------------
  function tick() {
    ensureFloatingButton();
    injectIntoComposer();
  }
  var obs = new MutationObserver(function () { tick(); });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(tick, 1500);
  tick();
})();
