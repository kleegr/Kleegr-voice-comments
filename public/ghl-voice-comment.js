/* =========================================================================
 * Kleegr — Voice note for GHL Internal Comments
 * -------------------------------------------------------------------------
 * v11: PERFORMANCE FIX. Stop reacting to every DOM mutation (that caused a
 * runaway loop that froze GHL). Run placement + player-upgrade on a calm
 * 1-second timer with a re-entrancy guard. Same features as v10.
 * ========================================================================= */
(function kleegrVoiceComment() {
  "use strict";

  // ---- CONFIG -------------------------------------------------------------
  var ENDPOINT = "https://kleegr-voice-comments.vercel.app/api/internal-comment";
  var VERSION = 11;
  // -------------------------------------------------------------------------

  if (window.__kleegrVoiceCommentInstalled === VERSION) return;
  window.__kleegrVoiceCommentInstalled = VERSION;

  var recording = false, pendingSend = false, pendingNote = "", mediaRecorder = null, chunks = [], timerInt = null, startedAt = 0, lastStream = null;

  function getLocationId() { var p = location.pathname || ""; var m = p.match(/\/v2\/location\/([a-zA-Z0-9]+)/); if (m) return m[1]; m = location.href.match(/[?&]locationId=([a-zA-Z0-9]+)/); return m ? m[1] : ""; }
  function getConversationId() { var seg = (location.pathname || "").split("/v2/location/")[1]; if (seg) { var parts = seg.split("/"); if (parts[1] === "conversations" && parts[2] === "conversations" && parts[3]) return parts[3]; } var m = location.href.match(/conversations\/conversations\/([A-Za-z0-9-]+)/); return m ? m[1] : ""; }
  function getContactId() { var seg = (location.pathname || "").split("/v2/location/")[1]; if (seg) { var parts = seg.split("/"); if (parts[1] === "contacts" && parts[2] === "detail" && parts[3]) return parts[3]; } var a = document.querySelector('a[href*="/contacts/detail/"]'); if (a) { var mm = a.getAttribute("href").match(/\/contacts\/detail\/([A-Za-z0-9]+)/); if (mm) return mm[1]; } return ""; }
  function getUserId() { try { if (window.__USER__ && window.__USER__.id) return window.__USER__.id; } catch (e) {} return ""; }

  function micSvg(c) { return '<svg width="21" height="21" viewBox="0 0 24 24" fill="' + c + '"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2Z"/></svg>'; }
  function checkSvg(c) { return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="' + c + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'; }
  function xSvg(c) { return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="' + c + '" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>'; }
  function playSvg() { return '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'; }
  function pauseSvg() { return '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'; }
  function fmt(s) { s = Math.floor(s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

  var AMBER = "#b45309", AMBER_BG = "#fff8e1", AMBER_BD = "#f59e0b";

  function injectStyleOnce() {
    if (document.getElementById("kleegr-voice-style")) return;
    var s = document.createElement("style"); s.id = "kleegr-voice-style";
    s.textContent =
      ".klg-wave{display:inline-flex;align-items:center;gap:2px;height:16px}" +
      ".klg-wave i{display:inline-block;width:2px;height:5px;background:" + AMBER + ";border-radius:1px;animation:klgwave .9s ease-in-out infinite}" +
      ".klg-wave i:nth-child(2){animation-delay:.12s}.klg-wave i:nth-child(3){animation-delay:.24s}" +
      ".klg-wave i:nth-child(4){animation-delay:.36s}.klg-wave i:nth-child(5){animation-delay:.48s}" +
      "@keyframes klgwave{0%,100%{height:5px}50%{height:15px}}";
    document.head.appendChild(s);
  }

  function wrap() { return document.getElementById("kleegr-voice-wrap"); }

  function renderIdle(target) {
    var w = target || wrap(); if (!w) return;
    w.innerHTML = "";
    var btn = document.createElement("button");
    btn.type = "button"; btn.title = "Record a voice note (internal comment)";
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
    var c = document.getElementById("kleegr-voice-cancel"); var s = document.getElementById("kleegr-voice-send");
    if (c) c.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); cancelRecording(); });
    if (s) s.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); confirmRecording(); });
  }

  function renderStatus(text, color, revertMs) {
    var w = wrap(); if (!w) return;
    w.innerHTML = '<span style="display:inline-flex;align-items:center;height:34px;padding:0 12px;border-radius:18px;background:' + AMBER_BG + ';border:1px solid ' + AMBER_BD + ';color:' + (color || AMBER) + ';font:600 12px system-ui,sans-serif;max-width:340px">' + text + '</span>';
    if (revertMs) setTimeout(function () { if (!recording && wrap()) renderIdle(); }, revertMs);
  }

  function isVisible(el) { if (!el) return false; if (el.offsetParent !== null) return true; var r = el.getClientRects(); return !!(r && r.length); }
  function activeInternalInput() {
    var inputs = document.querySelectorAll("textarea,[contenteditable='true']");
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (!isVisible(el)) continue;
      var ph = el.getAttribute ? (el.getAttribute("placeholder") || el.getAttribute("data-placeholder") || el.getAttribute("aria-label") || "") : "";
      if (!/internal comment/i.test(ph)) continue;
      if (el.getBoundingClientRect().height < 60) return null;
      return el;
    }
    return null;
  }
  function readComposerNote() {
    var el = activeInternalInput(); if (!el) return "";
    var t = (el.tagName === "TEXTAREA" || el.tagName === "INPUT") ? (el.value || "") : (el.textContent || "");
    return (t || "").trim();
  }
  function clearComposer() {
    var el = activeInternalInput(); if (!el) return;
    try {
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        var proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, "value");
        setter.set.call(el, "");
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } else { el.textContent = ""; el.dispatchEvent(new Event("input", { bubbles: true })); }
    } catch (e) {}
  }
  function footerFrom(el) {
    var card = el;
    for (var j = 0; j < 9 && card; j++) {
      var send = card.querySelector("#conv-send-button-simple,[data-testid='send-button'],.conv-send-button,button[type='submit'],[id*='send-button']");
      if (send) { var bar = send.parentElement; for (var k = 0; k < 5 && bar; k++) { if (bar.children && bar.children.length >= 2) return bar; bar = bar.parentElement; } return send.parentElement; }
      card = card.parentElement;
    }
    return null;
  }
  function placeWrap() {
    if (recording) return;
    var w = wrap();
    var input = activeInternalInput();
    if (!input) { if (w) w.remove(); return; }
    var footer = footerFrom(input);
    if (!footer) { if (w) w.remove(); return; }
    if (!w) { w = document.createElement("span"); w.id = "kleegr-voice-wrap"; w.style.cssText = "display:inline-flex;align-items:center;vertical-align:middle"; renderIdle(w); }
    var send = footer.querySelector("#conv-send-button-simple,[data-testid='send-button'],.conv-send-button,button[type='submit'],[id*='send-button']");
    var leftGroup = footer.firstElementChild;
    var target, before;
    if (leftGroup && send && !leftGroup.contains(send)) { target = leftGroup; before = leftGroup.firstChild; }
    else { target = footer; before = footer.firstChild; }
    if (w.parentNode !== target) { try { target.insertBefore(w, before); } catch (e) { footer.insertBefore(w, footer.firstChild); } }
  }

  function feedScope() {
    var comp = activeInternalInput() || document.querySelector("textarea,[contenteditable='true']");
    if (!comp) return null;
    var node = comp;
    for (var i = 0; i < 10 && node; i++) { if (node.getBoundingClientRect().height > 400) return node; node = node.parentElement; }
    return node || null;
  }
  var AUDIO_RE = /(\.webm|\.ogg|\.oga|\.mp3|\.m4a|\.wav)(\?|$)/i;
  function isAudioHref(href) { if (!href) return false; return AUDIO_RE.test(href) || /filesafe\.space\/[^\s]*\/media\//i.test(href); }

  function makeChip(href) {
    var chip = document.createElement("span");
    chip.className = "klg-audio-chip";
    chip.style.cssText = "display:inline-flex;align-items:center;gap:7px;background:" + AMBER_BG + ";border:1px solid " + AMBER_BD + ";border-radius:9px;padding:2px 8px;margin:2px 4px;vertical-align:middle";
    var audio = document.createElement("audio"); audio.src = href; audio.preload = "metadata";
    var play = document.createElement("button"); play.type = "button"; play.style.cssText = "border:none;background:transparent;cursor:pointer;display:inline-flex;align-items:center;padding:0;color:" + AMBER; play.innerHTML = playSvg();
    var barWrap = document.createElement("span"); barWrap.style.cssText = "position:relative;width:84px;height:4px;background:rgba(180,83,9,.25);border-radius:2px;cursor:pointer;flex:0 0 auto";
    var barFill = document.createElement("span"); barFill.style.cssText = "position:absolute;left:0;top:0;height:100%;width:0%;background:" + AMBER + ";border-radius:2px"; barWrap.appendChild(barFill);
    var time = document.createElement("span"); time.style.cssText = "font:600 11px system-ui;color:" + AMBER + ";white-space:nowrap"; time.textContent = "0:00";
    var speed = document.createElement("button"); speed.type = "button"; speed.style.cssText = "border:none;background:rgba(180,83,9,.12);border-radius:6px;cursor:pointer;font:700 10px system-ui;color:" + AMBER + ";padding:2px 5px"; var rates = [1, 1.5, 2, 0.75], ri = 0; speed.textContent = "1x";
    var open = document.createElement("a"); open.href = href; open.target = "_blank"; open.rel = "noopener"; open.textContent = "\u2197"; open.title = "Open in new tab"; open.style.cssText = "color:" + AMBER + ";text-decoration:none;font:700 12px system-ui";
    play.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); if (audio.paused) audio.play(); else audio.pause(); });
    audio.addEventListener("play", function () { play.innerHTML = pauseSvg(); });
    audio.addEventListener("pause", function () { play.innerHTML = playSvg(); });
    audio.addEventListener("ended", function () { play.innerHTML = playSvg(); });
    audio.addEventListener("loadedmetadata", function () { time.textContent = "0:00" + (isFinite(audio.duration) ? " / " + fmt(audio.duration) : ""); });
    audio.addEventListener("timeupdate", function () { if (audio.duration && isFinite(audio.duration)) { barFill.style.width = (audio.currentTime / audio.duration * 100) + "%"; time.textContent = fmt(audio.currentTime) + " / " + fmt(audio.duration); } else { time.textContent = fmt(audio.currentTime); } });
    barWrap.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); var r = barWrap.getBoundingClientRect(); var p = (e.clientX - r.left) / r.width; if (audio.duration && isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(1, p)) * audio.duration; });
    speed.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); ri = (ri + 1) % rates.length; audio.playbackRate = rates[ri]; speed.textContent = rates[ri] + "x"; });
    chip.appendChild(play); chip.appendChild(barWrap); chip.appendChild(time); chip.appendChild(speed); chip.appendChild(open); chip.appendChild(audio);
    return chip;
  }

  function upgradeAudioComments() {
    var scope = feedScope(); if (!scope) return;
    if ((scope.textContent || "").indexOf("Voice note") === -1) return;  // cheap short-circuit
    var links = scope.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.__klgDone) continue;
      var href = a.getAttribute("href") || "";
      if (!isAudioHref(href)) continue;
      a.__klgDone = true;
      if (a.parentNode) a.parentNode.insertBefore(makeChip(href), a.nextSibling);
      a.style.display = "none";
    }
    var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
    var hits = [], node;
    while ((node = walker.nextNode())) { var v = node.nodeValue || ""; if (v.indexOf("Voice note") > -1 && /https?:\/\//.test(v)) hits.push(node); }
    for (var h = 0; h < hits.length; h++) {
      var tn = hits[h]; var parent = tn.parentElement;
      if (!parent || parent.__klgAudioDone) continue;
      if (parent.childElementCount > 1) continue;
      if ((parent.textContent || "").length > 220) continue;
      var m = (tn.nodeValue || "").match(/(https?:\/\/[^\s\)\]]+)/); if (!m) continue;
      var url = m[1]; parent.__klgAudioDone = true;
      tn.nodeValue = tn.nodeValue.replace(url, "").replace(/\s+$/, "") + " ";
      if (parent.parentNode) parent.parentNode.insertBefore(makeChip(url), parent.nextSibling);
    }
  }

  function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { renderStatus("Mic not supported here", "#dc2626", 3000); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      lastStream = stream; chunks = [];
      var mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
      mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mediaRecorder.onstop = function () {
        if (lastStream) lastStream.getTracks().forEach(function (t) { t.stop(); });
        if (pendingSend) { send(new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" })); } else { renderIdle(); }
      };
      mediaRecorder.start();
      recording = true; pendingSend = false; startedAt = Date.now();
      renderRecording();
      timerInt = setInterval(function () { var s = Math.floor((Date.now() - startedAt) / 1000); var tm = document.getElementById("kleegr-voice-timer"); if (tm) tm.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }, 500);
    }).catch(function () { renderStatus("Mic permission denied", "#dc2626", 3000); });
  }
  function stopTimer() { if (timerInt) { clearInterval(timerInt); timerInt = null; } }
  function confirmRecording() {
    if (!recording) return;
    pendingNote = readComposerNote();
    recording = false; pendingSend = true; stopTimer();
    renderStatus("Sending…", "#2563eb");
    try { mediaRecorder && mediaRecorder.stop(); } catch (e) {}
  }
  function cancelRecording() { recording = false; pendingSend = false; stopTimer(); try { mediaRecorder && mediaRecorder.stop(); } catch (e) {} renderIdle(); }

  function send(blob) {
    var conversationId = getConversationId(), contactId = getContactId(), locationId = getLocationId();
    if (!conversationId && !contactId) { renderStatus("Can’t find the contact on this screen", "#dc2626", 5000); console.error("[kleegr-voice] no ids; url=", location.href); return; }
    var fd = new FormData();
    fd.append("file", blob, "voice-note.webm");
    if (contactId) fd.append("contactId", contactId);
    if (conversationId) fd.append("conversationId", conversationId);
    if (locationId) fd.append("locationId", locationId);
    if (pendingNote) fd.append("note", pendingNote);
    var uid = getUserId(); if (uid) fd.append("userId", uid);
    fetch(ENDPOINT, { method: "POST", body: fd })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.j && res.j.success) { if (pendingNote) clearComposer(); pendingNote = ""; renderStatus("Posted ✓", "#15803d", 2500); }
        else { var msg = (res.j && res.j.error) ? String(res.j.error).slice(0, 80) : "error"; renderStatus("Failed: " + msg, "#dc2626", 6000); console.error("[kleegr-voice] post failed:", res.j && res.j.error); }
      })
      .catch(function (err) { renderStatus("Network blocked", "#dc2626", 5000); console.error("[kleegr-voice] network error:", err); });
  }

  // ---- boot: calm 1s timer only (NO MutationObserver) ---------------------
  var ticking = false;
  function tick() {
    if (ticking) return;
    ticking = true;
    try { placeWrap(); upgradeAudioComments(); } catch (e) { /* never break the loop */ }
    ticking = false;
  }
  setInterval(tick, 1000);
  tick();
})();
