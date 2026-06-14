/* =========================================================================
 * Kleegr — Voice note for GHL Internal Comments
 * -------------------------------------------------------------------------
 * Records a voice note in the GHL conversation and posts it as an
 * InternalComment (audio attached) via the Vercel backend.
 *
 * v4: WhatsApp-style mic ICON (no text pill), placed next to the emoji on
 * the left of the Internal Comment composer. Contact resolved from the URL
 * path (same as the Reply/Forward script).
 * ========================================================================= */
(function kleegrVoiceComment() {
  "use strict";

  // ---- CONFIG -------------------------------------------------------------
  var ENDPOINT = "https://kleegr-voice-comments.vercel.app/api/internal-comment";
  var VERSION = 4;
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

  // ---- icons ---------------------------------------------------------------
  function micSvg(color) {
    return '<svg width="21" height="21" viewBox="0 0 24 24" fill="' + color + '"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2Z"/></svg>';
  }
  function checkSvg(color) {
    return '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  }

  // ---- button --------------------------------------------------------------
  function makeButton() {
    var btn = document.createElement("button");
    btn.id = "kleegr-voice-btn";
    btn.type = "button";
    btn.title = "Record a voice note (internal comment)";
    btn.style.cssText =
      "display:inline-flex;align-items:center;gap:5px;height:34px;min-width:34px;" +
      "padding:0 6px;border:none;border-radius:18px;background:transparent;" +
      "cursor:pointer;font:600 12px system-ui,sans-serif;vertical-align:middle;";
    btn.innerHTML =
      '<span id="kleegr-voice-ic" style="display:inline-flex;align-items:center">' + micSvg("#54656f") + "</span>" +
      '<span id="kleegr-voice-timer" style="display:none"></span>';
    btn.addEventListener("click", onClick);
    btn.addEventListener("mouseenter", function () { if (!recording) btn.style.background = "rgba(0,0,0,0.06)"; });
    btn.addEventListener("mouseleave", function () { btn.style.background = "transparent"; });
    return btn;
  }

  function setState(state) {
    var ic = document.getElementById("kleegr-voice-ic");
    var tm = document.getElementById("kleegr-voice-timer");
    if (!ic) return;
    if (state === "idle") { ic.innerHTML = micSvg("#54656f"); if (tm) { tm.style.display = "none"; tm.textContent = ""; } }
    else if (state === "recording") { ic.innerHTML = micSvg("#dc2626"); if (tm) { tm.style.display = "inline"; tm.style.color = "#dc2626"; } }
    else if (state === "sending") { ic.innerHTML = micSvg("#2563eb"); if (tm) { tm.style.display = "none"; } }
    else if (state === "posted") { ic.innerHTML = checkSvg("#15803d"); if (tm) { tm.style.display = "none"; } }
    else if (state === "failed") { ic.innerHTML = micSvg("#dc2626"); if (tm) { tm.style.display = "none"; } }
  }
  function setTimerText(t) {
    var tm = document.getElementById("kleegr-voice-timer");
    if (tm) tm.textContent = t;
  }

  // ---- find the Internal Comment composer footer (emoji/send row) ---------
  function findInternalCommentFooter() {
    var nodes = document.querySelectorAll("textarea,[contenteditable='true'],[placeholder]");
    for (var i = 0; i < nodes.length; i++) {
      var ph = (nodes[i].getAttribute && nodes[i].getAttribute("placeholder")) || "";
      var tx = ph || nodes[i].textContent || "";
      if (/internal comment/i.test(tx)) {
        var card = nodes[i];
        for (var j = 0; j < 9 && card; j++) {
          var send = card.querySelector(
            "#conv-send-button-simple,[data-testid='send-button'],.conv-send-button,button[type='submit'],[id*='send-button']"
          );
          if (send) {
            var bar = send.parentElement;
            for (var k = 0; k < 5 && bar; k++) {
              if (bar.children && bar.children.length >= 2) return bar;
              bar = bar.parentElement;
            }
            return send.parentElement;
          }
          card = card.parentElement;
        }
      }
    }
    return null;
  }

  function styleInline(btn) {
    btn.style.position = ""; btn.style.right = ""; btn.style.bottom = ""; btn.style.zIndex = "";
    btn.style.boxShadow = ""; btn.style.background = "transparent";
  }
  function styleFloating(btn) {
    btn.style.position = "fixed"; btn.style.right = "18px"; btn.style.bottom = "74px"; btn.style.zIndex = "99999";
    btn.style.background = "#ffffff"; btn.style.boxShadow = "0 2px 8px rgba(0,0,0,.18)";
  }

  // Guarantee one button; prefer inline next to the emoji, else floating.
  function placeButton() {
    if (recording) return;
    var btn = document.getElementById("kleegr-voice-btn");
    if (!btn) { btn = makeButton(); styleFloating(btn); document.body.appendChild(btn); }

    var footer = findInternalCommentFooter();
    if (!footer) return;

    var send = footer.querySelector(
      "#conv-send-button-simple,[data-testid='send-button'],.conv-send-button,button[type='submit'],[id*='send-button']"
    );
    var leftGroup = footer.firstElementChild;
    var target, before;
    if (leftGroup && send && !leftGroup.contains(send)) {
      // two-cluster layout: left icons (emoji/clear) vs right (send)
      target = leftGroup; before = leftGroup.firstChild;
    } else {
      // flat layout: drop at the very left
      target = footer; before = footer.firstChild;
    }
    if (btn.parentNode !== target) {
      styleInline(btn);
      try { target.insertBefore(btn, before); }
      catch (e) { footer.insertBefore(btn, footer.firstChild); }
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
      setState("recording");
      setTimerText("0:00");
      timerInt = setInterval(function () {
        var s = Math.floor((Date.now() - startedAt) / 1000);
        setTimerText(Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"));
      }, 500);
    }).catch(function () {
      alert("Microphone permission denied.");
    });
  }

  function stopRecording() {
    recording = false;
    if (timerInt) { clearInterval(timerInt); timerInt = null; }
    setState("sending");
    try { mediaRecorder && mediaRecorder.stop(); } catch (e) {}
  }

  function send(blob) {
    var conversationId = getConversationId();
    var contactId = getContactId();
    var locationId = getLocationId();
    if (!conversationId && !contactId) {
      setState("failed");
      console.error("[kleegr-voice] no conversationId/contactId found in URL");
      setTimeout(function () { setState("idle"); }, 2000);
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
        if (j && j.success) { setState("posted"); }
        else { setState("failed"); console.error("[kleegr-voice] post failed:", j && j.error); }
        setTimeout(function () { setState("idle"); }, 2000);
      })
      .catch(function (err) {
        setState("failed");
        console.error("[kleegr-voice] network error:", err);
        setTimeout(function () { setState("idle"); }, 2000);
      });
  }

  // ---- boot ----------------------------------------------------------------
  function tick() { placeButton(); }
  var obs = new MutationObserver(function () { tick(); });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(tick, 1500);
  tick();
})();
