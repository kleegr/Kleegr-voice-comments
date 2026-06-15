/* =========================================================================
 * Kleegr — Voice note for GHL Internal Comments
 * -------------------------------------------------------------------------
 * Records a voice note in the GHL conversation and posts it as an
 * InternalComment (audio attached) via the Vercel backend.
 *
 * v5: yellow recording bar (timer + waveform + cancel/send), placed next to
 * the emoji. Shows failure reasons on-screen so issues are self-diagnosing.
 * ========================================================================= */
(function kleegrVoiceComment() {
  "use strict";

  // ---- CONFIG -------------------------------------------------------------
  var ENDPOINT = "https://kleegr-voice-comments.vercel.app/api/internal-comment";
  var VERSION = 5;
  // -------------------------------------------------------------------------

  if (window.__kleegrVoiceCommentInstalled === VERSION) return;
  window.__kleegrVoiceCommentInstalled = VERSION;

  var recording = false;
  var pendingSend = false;
  var mediaRecorder = null;
  var chunks = [];
  var timerInt = null;
  var startedAt = 0;
  var lastStream = null;

  // ---- resolve who we're commenting on (mirrors forwardMessage.v1.js) ----
  function getLocationId() {
    var p = location.pathname || "";
    var m = p.match(/\/v2\/location\/([a-zA-Z0-9]+)/);
    if (m) return m[1];
    m = location.href.match(/[?&]locationId=([a-zA-Z0-9]+)/);
    return m ? m[1] : "";
  }
  function getConversationId() {
    var seg = (location.pathname || "").split("/v2/location/")[1];
    if (seg) {
      var parts = seg.split("/");
      if (parts[1] === "conversations" && parts[2] === "conversations" && parts[3]) return parts[3];
    }
    var m = location.href.match(/conversations\/conversations\/([A-Za-z0-9-]+)/);
    return m ? m[1] : "";
  }
  function getContactId() {
    var seg = (location.pathname || "").split("/v2/location/")[1];
    if (seg) {
      var parts = seg.split("/");
      if (parts[1] === "contacts" && parts[2] === "detail" && parts[3]) return parts[3];
    }
    var a = document.querySelector('a[href*="/contacts/detail/"]');
    if (a) { var mm = a.getAttribute("href").match(/\/contacts\/detail\/([A-Za-z0-9]+)/); if (mm) return mm[1]; }
    return "";
  }
  function getUserId() {
    try { if (window.__USER__ && window.__USER__.id) return window.__USER__.id; } catch (e) {}
    return "";
  }

  // ---- icons ---------------------------------------------------------------
  function micSvg(c) { return '<svg width="21" height="21" viewBox="0 0 24 24" fill="' + c + '"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2Z"/></svg>'; }
  function checkSvg(c) { return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="' + c + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'; }
  function xSvg(c) { return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="' + c + '" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>'; }

  // amber palette = “internal comment”
  var AMBER = "#b45309", AMBER_BG = "#fff8e1", AMBER_BD = "#f59e0b";

  function injectStyleOnce() {
    if (document.getElementById("kleegr-voice-style")) return;
    var s = document.createElement("style");
    s.id = "kleegr-voice-style";
    s.textContent =
      ".klg-wave{display:inline-flex;align-items:center;gap:2px;height:16px}" +
      ".klg-wave i{display:inline-block;width:2px;height:5px;background:" + AMBER + ";border-radius:1px;animation:klgwave .9s ease-in-out infinite}" +
      ".klg-wave i:nth-child(2){animation-delay:.12s}.klg-wave i:nth-child(3){animation-delay:.24s}" +
      ".klg-wave i:nth-child(4){animation-delay:.36s}.klg-wave i:nth-child(5){animation-delay:.48s}" +
      "@keyframes klgwave{0%,100%{height:5px}50%{height:15px}}";
    document.head.appendChild(s);
  }

  // ---- render states into the wrap ----------------------------------------
  function wrap() { return document.getElementById("kleegr-voice-wrap"); }

  function renderIdle() {
    var w = wrap(); if (!w) return;
    w.innerHTML = "";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Record a voice note (internal comment)";
    btn.style.cssText = "display:inline-flex;align-items:center;justify-content:center;height:34px;width:34px;border:none;border-radius:50%;background:transparent;cursor:pointer;";
    btn.innerHTML = micSvg(AMBER);
    btn.addEventListener("mouseenter", function () { btn.style.background = "rgba(180,83,9,0.10)"; });
    btn.addEventListener("mouseleave", function () { btn.style.background = "transparent"; });
    btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); startRecording(); });
    w.appendChild(btn);
  }

  function renderRecording() {
    var w = wrap(); if (!w) return;
    injectStyleOnce();
    w.innerHTML =
      '<span style="display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 10px;border-radius:18px;background:' + AMBER_BG + ';border:1px solid ' + AMBER_BD + ';color:' + AMBER + ';font:600 12px system-ui,sans-serif">' +
      '<span style="width:8px;height:8px;border-radius:50%;background:#dc2626;display:inline-block"></span>' +
      '<span class="klg-wave"><i></i><i></i><i></i><i></i><i></i></span>' +
      '<span id="kleegr-voice-timer">0:00</span>' +
      '<span id="kleegr-voice-cancel" title="Cancel" style="cursor:pointer;display:inline-flex;padding:2px">' + xSvg(AMBER) + '</span>' +
      '<span id="kleegr-voice-send" title="Send as internal comment" style="cursor:pointer;display:inline-flex;padding:2px">' + checkSvg("#15803d") + '</span>' +
      '</span>';
    var c = document.getElementById("kleegr-voice-cancel");
    var s = document.getElementById("kleegr-voice-send");
    if (c) c.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); cancelRecording(); });
    if (s) s.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); confirmRecording(); });
  }

  function renderStatus(text, color, revertMs) {
    var w = wrap(); if (!w) return;
    w.innerHTML =
      '<span style="display:inline-flex;align-items:center;height:34px;padding:0 12px;border-radius:18px;background:' + AMBER_BG + ';border:1px solid ' + AMBER_BD + ';color:' + (color || AMBER) + ';font:600 12px system-ui,sans-serif;max-width:340px">' +
      text + '</span>';
    if (revertMs) setTimeout(function () { if (!recording) renderIdle(); }, revertMs);
  }

  // ---- placement -----------------------------------------------------------
  function findInternalCommentFooter() {
    var nodes = document.querySelectorAll("textarea,[contenteditable='true'],[placeholder]");
    for (var i = 0; i < nodes.length; i++) {
      var ph = (nodes[i].getAttribute && nodes[i].getAttribute("placeholder")) || "";
      var tx = ph || nodes[i].textContent || "";
      if (/internal comment/i.test(tx)) {
        var card = nodes[i];
        for (var j = 0; j < 9 && card; j++) {
          var send = card.querySelector("#conv-send-button-simple,[data-testid='send-button'],.conv-send-button,button[type='submit'],[id*='send-button']");
          if (send) {
            var bar = send.parentElement;
            for (var k = 0; k < 5 && bar; k++) { if (bar.children && bar.children.length >= 2) return bar; bar = bar.parentElement; }
            return send.parentElement;
          }
          card = card.parentElement;
        }
      }
    }
    return null;
  }

  function placeWrap() {
    if (recording) return;
    var w = wrap();
    if (!w) {
      w = document.createElement("span");
      w.id = "kleegr-voice-wrap";
      w.style.cssText = "display:inline-flex;align-items:center;vertical-align:middle";
      document.body.appendChild(w);
      w.style.position = "fixed"; w.style.right = "18px"; w.style.bottom = "74px"; w.style.zIndex = "99999";
      renderIdle();
    }
    var footer = findInternalCommentFooter();
    if (!footer) return;
    var send = footer.querySelector("#conv-send-button-simple,[data-testid='send-button'],.conv-send-button,button[type='submit'],[id*='send-button']");
    var leftGroup = footer.firstElementChild;
    var target, before;
    if (leftGroup && send && !leftGroup.contains(send)) { target = leftGroup; before = leftGroup.firstChild; }
    else { target = footer; before = footer.firstChild; }
    if (w.parentNode !== target) {
      w.style.position = ""; w.style.right = ""; w.style.bottom = ""; w.style.zIndex = "";
      try { target.insertBefore(w, before); } catch (e) { footer.insertBefore(w, footer.firstChild); }
    }
  }

  // ---- recording -----------------------------------------------------------
  function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { renderStatus("Mic not supported here", "#dc2626", 3000); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      lastStream = stream;
      chunks = [];
      var mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
        : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
      mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mediaRecorder.onstop = function () {
        if (lastStream) lastStream.getTracks().forEach(function (t) { t.stop(); });
        if (pendingSend) {
          var blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
          send(blob);
        } else {
          renderIdle();
        }
      };
      mediaRecorder.start();
      recording = true; pendingSend = false; startedAt = Date.now();
      renderRecording();
      timerInt = setInterval(function () {
        var s = Math.floor((Date.now() - startedAt) / 1000);
        var tm = document.getElementById("kleegr-voice-timer");
        if (tm) tm.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
      }, 500);
    }).catch(function () { renderStatus("Mic permission denied", "#dc2626", 3000); });
  }

  function stopTimer() { if (timerInt) { clearInterval(timerInt); timerInt = null; } }

  function confirmRecording() {
    if (!recording) return;
    recording = false; pendingSend = true; stopTimer();
    renderStatus("Sending…", "#2563eb");
    try { mediaRecorder && mediaRecorder.stop(); } catch (e) {}
  }
  function cancelRecording() {
    recording = false; pendingSend = false; stopTimer();
    try { mediaRecorder && mediaRecorder.stop(); } catch (e) {}
    renderIdle();
  }

  function send(blob) {
    var conversationId = getConversationId();
    var contactId = getContactId();
    var locationId = getLocationId();
    if (!conversationId && !contactId) {
      renderStatus("Can’t find the contact on this screen", "#dc2626", 5000);
      console.error("[kleegr-voice] no conversationId/contactId; url=", location.href);
      return;
    }
    var fd = new FormData();
    fd.append("file", blob, "voice-note.webm");
    if (contactId) fd.append("contactId", contactId);
    if (conversationId) fd.append("conversationId", conversationId);
    if (locationId) fd.append("locationId", locationId);
    var uid = getUserId(); if (uid) fd.append("userId", uid);

    fetch(ENDPOINT, { method: "POST", body: fd })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.j && res.j.success) { renderStatus("Posted ✓", "#15803d", 2500); }
        else {
          var msg = (res.j && res.j.error) ? String(res.j.error).slice(0, 80) : ("HTTP " + (res.ok ? "200" : "error"));
          renderStatus("Failed: " + msg, "#dc2626", 6000);
          console.error("[kleegr-voice] post failed:", res.j && res.j.error);
        }
      })
      .catch(function (err) {
        renderStatus("Network blocked", "#dc2626", 5000);
        console.error("[kleegr-voice] network error:", err);
      });
  }

  // ---- boot ----------------------------------------------------------------
  function tick() { placeWrap(); }
  var obs = new MutationObserver(function () { tick(); });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(tick, 1500);
  tick();
})();
