/* =========================================================================
 * Kleegr — Voice note for GHL Internal Comments
 * -------------------------------------------------------------------------
 * Records a voice note in the GHL conversation and posts it as an
 * InternalComment (audio attached) via the Vercel backend.
 *
 * v3: resolve the contact the same way the WhatsApp Reply/Forward script does
 * (conversationId / contactId from the URL path), and place the mic next to
 * the emoji icon in the Internal Comment composer.
 * ========================================================================= */
(function kleegrVoiceComment() {
  "use strict";

  // ---- CONFIG -------------------------------------------------------------
  var ENDPOINT = "https://kleegr-voice-comments.vercel.app/api/internal-comment";
  var VERSION = 3;
  // -------------------------------------------------------------------------

  if (window.__kleegrVoiceCommentInstalled === VERSION) return;
  window.__kleegrVoiceCommentInstalled = VERSION;

  var recording = false;
  var mediaRecorder = null;
  var chunks = [];
  var timerInt = null;
  var startedAt = 0;

  // ---- resolve who we're commenting on (mirrors forwardMessage.v1.js) ----
  function getLocationId() {
    var path = location.pathname || "";
    var m = path.match(/\/v2\/location\/([a-zA-Z0-9]+)/);
    if (m) return m[1];
    m = location.href.match(/[?&]locationId=([a-zA-Z0-9]+)/);
    return m ? m[1] : "";
  }
  function getConversationId() {
    var path = location.pathname || "";
    var seg = path.split("/v2/location/")[1];
    if (seg) {
      var parts = seg.split("/");
      // /v2/location/<loc>/conversations/conversations/<conversationId>
      if (parts[1] === "conversations" && parts[2] === "conversations" && parts[3]) return parts[3];
    }
    var m = location.href.match(/conversations\/conversations\/([A-Za-z0-9-]+)/);
    return m ? m[1] : "";
  }
  function getContactId() {
    var path = location.pathname || "";
    var seg = path.split("/v2/location/")[1];
    if (seg) {
      var parts = seg.split("/");
      // /v2/location/<loc>/contacts/detail/<contactId>
      if (parts[1] === "contacts" && parts[2] === "detail" && parts[3]) return parts[3];
    }
    var a = document.querySelector('a[href*="/contacts/detail/"]');
    if (a) {
      var mm = a.getAttribute("href").match(/\/contacts\/detail\/([A-Za-z0-9]+)/);
      if (mm) return mm[1];
    }
    return "";
  }
  function getUserId() {
    try { if (window.__USER__ && window.__USER__.id) return window.__USER__.id; } catch (e) {}
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
      "gap:6px", "height:34px", "padding:0 12px", "border-radius:9999px",
      "border:1px solid #e2e8f0", "background:#fff8e1", "color:#a16207",
      "font:600 13px system-ui,sans-serif", "cursor:pointer", "margin:0 6px",
      "box-shadow:0 1px 2px rgba(0,0,0,.06)", "vertical-align:middle"
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

  // Find the Internal Comment composer's action bar (where emoji/send live).
  function findInternalCommentBar() {
    var nodes = document.querySelectorAll("textarea, [contenteditable='true'], [placeholder]");
    for (var i = 0; i < nodes.length; i++) {
      var ph = (nodes[i].getAttribute && nodes[i].getAttribute("placeholder")) || "";
      var tx = ph || nodes[i].textContent || "";
      if (/internal comment/i.test(tx)) {
        // climb to the composer card, then find the row holding the buttons
        var node = nodes[i];
        for (var j = 0; j < 7 && node; j++) {
          var btns = node.querySelectorAll("button, [role='button']");
          if (btns.length >= 1) {
            // the bar is the parent of the first (left-most, i.e. emoji) button
            return { bar: btns[0].parentElement || node, firstBtn: btns[0] };
          }
          node = node.parentElement;
        }
      }
    }
    return null;
  }

  // Guarantee a button exists; prefer inline next to the emoji, else floating.
  function placeButton() {
    if (recording) return;
    var btn = document.getElementById("kleegr-voice-btn");
    if (!btn) {
      btn = makeButton();
      btn.style.position = "fixed";
      btn.style.right = "18px";
      btn.style.bottom = "72px";
      btn.style.zIndex = "99999";
      document.body.appendChild(btn);
    }
    var found = findInternalCommentBar();
    if (found && found.bar && btn.parentNode !== found.bar) {
      // move inline, clear floating styles, sit just left of the emoji button
      btn.style.position = "";
      btn.style.right = "";
      btn.style.bottom = "";
      btn.style.zIndex = "";
      try { found.bar.insertBefore(btn, found.firstBtn); }
      catch (e) { found.bar.insertBefore(btn, found.bar.firstChild); }
    }
  }

  // ---- recording -----------------------------------------------------------
  function onClick(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (recording) { stopRecording(); } else { startRecording(); }
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
    var contactId = getContactId();
    var locationId = getLocationId();
    if (!conversationId && !contactId) {
      setLabel("Open a chat first", "#dc2626", "#fef2f2");
      setTimeout(reset, 2500);
      return;
    }
    var fd = new FormData();
    fd.append("file", blob, "voice-note.webm");
    if (contactId) fd.append("contactId", contactId);
    if (conversationId) fd.append("conversationId", conversationId);
    if (locationId) fd.append("locationId", locationId);
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
  function tick() { placeButton(); }
  var obs = new MutationObserver(function () { tick(); });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(tick, 1500);
  tick();
})();
