/**
 * Kleegr — Voice Notes + File Attachments for GHL Internal Comments
 * Version 35 — Clean rebuild with all features.
 *
 * FEATURES:
 * 1. 🎤 Mic button — record voice notes, posted as Internal Comments
 * 2. 📎 Paperclip button — click to attach any file, staged before sending
 * 3. Drag-and-drop on the Internal Comment composer — stages file
 * 4. Custom audio player for voice notes (play, seek, speed, delete)
 * 5. NH initials via GHL's exposeSessionDetails (not generic "US")
 * 6. All subaccounts via per-location tokens from Supabase
 * 7. Delete button on voice notes (cosmetic, session-only)
 *
 * HOW IT WORKS:
 * - Voice notes: audio URL goes in the message TEXT (so our player script finds
 *   the <a> tag GHL auto-creates). NOT in the attachments array (that causes
 *   GHL to render its own ugly native player).
 * - File attachments: file URL goes in the attachments array (GHL renders nice
 *   native previews for PDFs, images, etc). Also in the text as a link.
 * - The script runs on a calm 1-second timer. No MutationObserver.
 */
(function kleegrVoiceComment() {
  "use strict";

  /* ═══════════════════════ CONFIG ═══════════════════════ */
  var ENDPOINT = "https://kleegr-voice-comments.vercel.app/api/internal-comment";
  var DECRYPT_ENDPOINT = "https://kleegr-voice-comments.vercel.app/api/decrypt-session";
  var APP_ID = "69d29cd45ed1d5be94e6e582";
  var VERSION = 35;

  if (window.__kleegrVoiceCommentInstalled === VERSION) return;
  window.__kleegrVoiceCommentInstalled = VERSION;
  console.log("[kleegr-voice] v" + VERSION + " loaded");

  /* ═══════════════════════ STATE ═══════════════════════ */
  var recording = false;
  var pendingSend = false;
  var mediaRecorder = null;
  var chunks = [];
  var timerInt = null;
  var startedAt = 0;
  var lastStream = null;
  var deletedUrls = {};
  var stagedFile = null;

  /* ═══════════════════════ URL/ID HELPERS ═══════════════════════ */
  function getLocationId() {
    var m = (location.pathname || "").match(/\/v2\/location\/([a-zA-Z0-9]+)/);
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
    if (a) {
      var mm = a.getAttribute("href").match(/\/contacts\/detail\/([A-Za-z0-9]+)/);
      if (mm) return mm[1];
    }
    return "";
  }

  /* ═══════════════════════ USER ID (exposeSessionDetails) ═══════════════════════ */
  var USERID_KEY = "kleegr_voice_ghl_user_id";
  var _resolving = false;
  function getCachedUserId() { try { return localStorage.getItem(USERID_KEY) || ""; } catch (e) { return ""; } }
  function cacheUserId(uid) { try { localStorage.setItem(USERID_KEY, uid); } catch (e) {} }
  function resolveUserSession() {
    if (getCachedUserId() || _resolving) return;
    if (typeof window.exposeSessionDetails !== "function") return;
    _resolving = true;
    try {
      window.exposeSessionDetails(APP_ID).then(function (enc) {
        if (!enc) { _resolving = false; return; }
        fetch(DECRYPT_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ encryptedData: enc })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          _resolving = false;
          if (d && d.userId) {
            cacheUserId(d.userId);
            console.log("[kleegr-voice] userId resolved:", d.userId, d.userName);
          }
        })
        .catch(function () { _resolving = false; });
      }).catch(function () { _resolving = false; });
    } catch (e) { _resolving = false; }
  }

  /* ═══════════════════════ SVG ICONS ═══════════════════════ */
  function micSvg(c) { return '<svg width="21" height="21" viewBox="0 0 24 24" fill="' + c + '"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2Z"/></svg>'; }
  function clipSvg(c) { return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>'; }
  function checkSvg(c) { return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="' + c + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'; }
  function xSvg(c) { return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="' + c + '" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>'; }
  function playSvg() { return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'; }
  function pauseSvg() { return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'; }
  function trashSvg() { return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'; }
  function sendSvg(c) { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="' + c + '"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>'; }
  function fmt(s) { s = Math.floor(s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

  var AMBER = "#b45309", AMBER_BG = "#fff8e1", AMBER_BD = "#f59e0b";

  /* ═══════════════════════ CSS ═══════════════════════ */
  function injectStyleOnce() {
    if (document.getElementById("kleegr-voice-style")) return;
    var s = document.createElement("style");
    s.id = "kleegr-voice-style";
    s.textContent = [
      'a[href$=".webm"],a[href$=".ogg"],a[href$=".oga"],a[href$=".mp3"],a[href$=".m4a"],a[href$=".wav"]{display:none!important}',
      '.klg-wave{display:inline-flex;align-items:center;gap:2px;height:16px}',
      '.klg-wave i{display:inline-block;width:2px;height:5px;background:' + AMBER + ';border-radius:1px;animation:klgwave .9s ease-in-out infinite}',
      '.klg-wave i:nth-child(2){animation-delay:.12s}',
      '.klg-wave i:nth-child(3){animation-delay:.24s}',
      '.klg-wave i:nth-child(4){animation-delay:.36s}',
      '.klg-wave i:nth-child(5){animation-delay:.48s}',
      '@keyframes klgwave{0%,100%{height:5px}50%{height:15px}}',
      '.klg-dropzone{position:absolute;inset:0;background:rgba(180,83,9,.08);border:2px dashed ' + AMBER_BD + ';border-radius:8px;display:flex;align-items:center;justify-content:center;font:600 14px system-ui;color:' + AMBER + ';z-index:999;pointer-events:none}',
      '.klg-staged{display:flex;align-items:center;gap:6px;padding:4px 10px;margin:4px 0;border-radius:8px;background:' + AMBER_BG + ';border:1px solid ' + AMBER_BD + ';font:500 12px system-ui;color:' + AMBER + '}',
      '.klg-staged-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}'
    ].join("");
    document.head.appendChild(s);
  }

  /* ═══════════════════════ DOM HELPERS ═══════════════════════ */
  function isVisible(el) {
    if (!el) return false;
    if (el.offsetParent !== null) return true;
    var r = el.getClientRects();
    return !!(r && r.length);
  }
  function escHtml(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
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
        if (setter && setter.set) { setter.set.call(el, ""); el.dispatchEvent(new Event("input", { bubbles: true })); }
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
  function inInboxList(el) {
    var node = el;
    for (var i = 0; i < 12 && node; i++) {
      if (node.querySelectorAll) { var rows = node.querySelectorAll('a[href*="/conversations/conversations/"]'); if (rows.length >= 3) return true; }
      node = node.parentElement;
    }
    return false;
  }

  /* ═══════════════════════ UPLOAD TO SERVER ═══════════════════════ */
  function uploadToServer(file, isVoice, noteText, statusCb) {
    var conversationId = getConversationId(), contactId = getContactId(), locationId = getLocationId();
    if (!conversationId && !contactId) { if (statusCb) statusCb("Can\u2019t find contact", "#dc2626", 5000); return; }
    var fd = new FormData();
    fd.append("file", file, file.name || (isVoice ? "voice-note.webm" : "attachment"));
    if (contactId) fd.append("contactId", contactId);
    if (conversationId) fd.append("conversationId", conversationId);
    if (locationId) fd.append("locationId", locationId);
    if (noteText) fd.append("note", noteText);
    if (!isVoice) fd.append("fileName", file.name || "attachment");
    var uid = getCachedUserId(); if (uid) fd.append("userId", uid);
    if (statusCb) statusCb("Uploading\u2026", "#2563eb");
    fetch(ENDPOINT, { method: "POST", body: fd })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.j && res.j.success) {
          if (statusCb) statusCb("Posted \u2713", "#15803d", 2500);
          [200, 500, 1000, 1800, 2800].forEach(function (d) { setTimeout(function () { try { upgradeAudioComments(); } catch (e) {} }, d); });
        } else {
          var msg = (res.j && res.j.error) ? String(res.j.error).slice(0, 80) : "error";
          if (statusCb) statusCb("Failed: " + msg, "#dc2626", 6000);
        }
      }).catch(function () { if (statusCb) statusCb("Network error", "#dc2626", 5000); });
  }

  /* ═══════════════════════ STAGED FILE ═══════════════════════ */
  function showStagedFile(file) {
    stagedFile = file;
    removeStagedBar();
    var input = activeInternalInput();
    if (!input) { console.log("[kleegr-voice] showStagedFile: Internal Comment not open"); return; }
    var bar = document.createElement("div"); bar.id = "kleegr-staged-bar"; bar.className = "klg-staged";
    var sizeText = file.size > 1048576 ? (file.size / 1048576).toFixed(1) + " MB" : (file.size / 1024).toFixed(0) + " KB";
    bar.innerHTML = '<span>\uD83D\uDCCE</span><span class="klg-staged-name">' + escHtml(file.name) + '</span><span style="opacity:.6;font-size:11px">' + sizeText + '</span>';
    var rm = document.createElement("button"); rm.type = "button";
    rm.style.cssText = "border:none;background:transparent;cursor:pointer;color:#dc2626;font:700 14px system-ui;padding:2px 4px";
    rm.textContent = "\u2715"; rm.title = "Remove attachment";
    rm.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); stagedFile = null; removeStagedBar(); });
    var sendBtn = document.createElement("button"); sendBtn.type = "button"; sendBtn.title = "Send with attachment";
    sendBtn.style.cssText = "border:none;background:" + AMBER + ";color:white;border-radius:50%;width:26px;height:26px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0";
    sendBtn.innerHTML = sendSvg("white");
    sendBtn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); sendStagedFile(); });
    bar.appendChild(rm); bar.appendChild(sendBtn);
    var footer = footerFrom(input);
    if (footer && footer.parentElement) { footer.parentElement.insertBefore(bar, footer); }
    else { input.parentElement.insertBefore(bar, input.nextSibling); }
    console.log("[kleegr-voice] file staged:", file.name, sizeText);
  }
  function removeStagedBar() { var b = document.getElementById("kleegr-staged-bar"); if (b) b.remove(); }
  function sendStagedFile() {
    if (!stagedFile) return;
    var f = stagedFile; var noteText = readComposerNote();
    stagedFile = null; removeStagedBar(); clearComposer();
    uploadToServer(f, false, noteText, function (t, c, ms) { renderStatus(t, c, ms); });
  }

  /* ═══════════════════════ MIC BUTTON UI ═══════════════════════ */
  function wrap() { return document.getElementById("kleegr-voice-wrap"); }
  function clipEl() { return document.getElementById("kleegr-clip-wrap"); }
  function renderIdle(target) {
    var w = target || wrap(); if (!w) return; w.innerHTML = "";
    var btn = document.createElement("button"); btn.type = "button"; btn.title = "Record a voice note (internal comment)";
    btn.style.cssText = "display:inline-flex;align-items:center;justify-content:center;height:34px;width:34px;border:none;border-radius:50%;background:transparent;cursor:pointer;";
    btn.innerHTML = micSvg(AMBER);
    btn.addEventListener("mouseenter", function () { btn.style.background = "rgba(180,83,9,0.10)"; });
    btn.addEventListener("mouseleave", function () { btn.style.background = "transparent"; });
    btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); startRecording(); });
    w.appendChild(btn);
  }
  function renderRecording() {
    var w = wrap(); if (!w) return;
    w.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 10px;border-radius:18px;background:' + AMBER_BG + ';border:1px solid ' + AMBER_BD + ';color:' + AMBER + ';font:600 12px system-ui,sans-serif"><span style="width:8px;height:8px;border-radius:50%;background:#dc2626;display:inline-block"></span><span class="klg-wave"><i></i><i></i><i></i><i></i><i></i></span><span id="kleegr-voice-timer">0:00</span><span id="kleegr-voice-cancel" title="Cancel" style="cursor:pointer;display:inline-flex;padding:2px">' + xSvg(AMBER) + '</span><span id="kleegr-voice-send" title="Send" style="cursor:pointer;display:inline-flex;padding:2px">' + checkSvg("#15803d") + '</span></span>';
    var c = document.getElementById("kleegr-voice-cancel"), s = document.getElementById("kleegr-voice-send");
    if (c) c.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); cancelRecording(); });
    if (s) s.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); confirmRecording(); });
  }
  function renderStatus(text, color, ms) {
    var w = wrap(); if (!w) return;
    w.innerHTML = '<span style="display:inline-flex;align-items:center;height:34px;padding:0 12px;border-radius:18px;background:' + AMBER_BG + ';border:1px solid ' + AMBER_BD + ';color:' + (color || AMBER) + ';font:600 12px system-ui,sans-serif;max-width:340px">' + text + '</span>';
    if (ms) setTimeout(function () { if (!recording && wrap()) renderIdle(); }, ms);
  }

  /* ═══════════════════════ PAPERCLIP BUTTON UI ═══════════════════════ */
  function renderClip(target) {
    var w = target || clipEl(); if (!w) return; w.innerHTML = "";
    var inp = document.createElement("input"); inp.type = "file"; inp.multiple = false; inp.style.display = "none";
    inp.addEventListener("change", function () { if (inp.files && inp.files[0]) { showStagedFile(inp.files[0]); inp.value = ""; } });
    var btn = document.createElement("button"); btn.type = "button"; btn.title = "Attach a file (internal comment)";
    btn.style.cssText = "display:inline-flex;align-items:center;justify-content:center;height:34px;width:34px;border:none;border-radius:50%;background:transparent;cursor:pointer;";
    btn.innerHTML = clipSvg(AMBER);
    btn.addEventListener("mouseenter", function () { btn.style.background = "rgba(180,83,9,0.10)"; });
    btn.addEventListener("mouseleave", function () { btn.style.background = "transparent"; });
    btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); inp.click(); });
    w.appendChild(inp); w.appendChild(btn);
  }

  /* ═══════════════════════ DRAG AND DROP ═══════════════════════ */
  function setupDragDrop() {
    var input = activeInternalInput(); if (!input) return;
    var card = input; for (var i = 0; i < 8 && card; i++) { if (card.getBoundingClientRect().height > 80) break; card = card.parentElement; }
    if (!card || card.__klgDropV35) return;
    card.__klgDropV35 = true; card.style.position = "relative";
    var overlay = null;
    card.addEventListener("dragenter", function (e) { e.preventDefault(); e.stopPropagation(); if (!overlay) { overlay = document.createElement("div"); overlay.className = "klg-dropzone"; overlay.textContent = "Drop file to attach"; card.appendChild(overlay); } });
    card.addEventListener("dragover", function (e) { e.preventDefault(); e.stopPropagation(); });
    card.addEventListener("dragleave", function (e) { if (overlay && !card.contains(e.relatedTarget)) { overlay.remove(); overlay = null; } });
    card.addEventListener("drop", function (e) { e.preventDefault(); e.stopPropagation(); if (overlay) { overlay.remove(); overlay = null; } var files = e.dataTransfer && e.dataTransfer.files; if (files && files.length) { showStagedFile(files[0]); } });
  }

  /* ═══════════════════════ PLACE BUTTONS IN FOOTER ═══════════════════════ */
  function placeWrap() {
    if (recording) return;
    var w = wrap(), cw = clipEl(), input = activeInternalInput();
    if (!input) { if (w) w.remove(); if (cw) cw.remove(); return; }
    var footer = footerFrom(input);
    if (!footer) { if (w) w.remove(); if (cw) cw.remove(); return; }
    if (!w) { w = document.createElement("span"); w.id = "kleegr-voice-wrap"; w.style.cssText = "display:inline-flex;align-items:center;vertical-align:middle"; renderIdle(w); }
    if (!cw) { cw = document.createElement("span"); cw.id = "kleegr-clip-wrap"; cw.style.cssText = "display:inline-flex;align-items:center;vertical-align:middle"; renderClip(cw); }
    var tgt = footer, bef = footer.firstChild;
    if (w.parentNode !== tgt) { try { tgt.insertBefore(w, bef); } catch (e) {} }
    if (cw.parentNode !== tgt) { try { tgt.insertBefore(cw, w.nextSibling); } catch (e) {} }
    setupDragDrop();
  }

  /* ═══════════════════════ AUDIO PLAYER ═══════════════════════ */
  var AUDIO_EXT_RE = /\.(webm|ogg|oga|mp3|m4a|wav)(\?|$)/i;
  function isAudioHref(href) { if (!href) return false; return AUDIO_EXT_RE.test(href); }
  function chipExistsForDoc(href) { var auds = document.querySelectorAll("audio.klg-audio"); for (var i = 0; i < auds.length; i++) { if (auds[i].getAttribute("src") === href) return true; } return false; }
  function hideMessageRow(el) {
    var node = el;
    for (var i = 0; i < 20 && node && node !== document.body; i++) {
      try { var cs = window.getComputedStyle(node); var bg = cs.backgroundColor || "";
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent" && bg !== "rgb(255, 255, 255)" && bg.indexOf("255, 255, 255") === -1) {
          var target = node; for (var j = 0; j < 3; j++) { if (target.parentElement && target.parentElement !== document.body) target = target.parentElement; }
          target.style.display = "none"; return true;
        } } catch (e) {}
      node = node.parentElement;
    }
    return false;
  }
  function makeChip(href) {
    var chip = document.createElement("span"); chip.className = "klg-audio-chip";
    chip.style.cssText = "display:inline-flex;align-items:center;gap:8px;vertical-align:middle;margin-left:4px";
    var audio = document.createElement("audio"); audio.className = "klg-audio"; audio.src = href; audio.preload = "metadata";
    var play = document.createElement("button"); play.type = "button";
    play.style.cssText = "border:none;background:rgba(180,83,9,.15);border-radius:50%;width:26px;height:26px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;color:" + AMBER;
    play.innerHTML = playSvg();
    var barWrap = document.createElement("span"); barWrap.style.cssText = "position:relative;width:96px;height:4px;background:rgba(180,83,9,.25);border-radius:2px;cursor:pointer;flex:0 0 auto";
    var barFill = document.createElement("span"); barFill.style.cssText = "position:absolute;left:0;top:0;height:100%;width:0%;background:" + AMBER + ";border-radius:2px"; barWrap.appendChild(barFill);
    var time = document.createElement("span"); time.style.cssText = "font:600 11px system-ui;color:" + AMBER + ";white-space:nowrap"; time.textContent = "0:00";
    var speed = document.createElement("button"); speed.type = "button";
    speed.style.cssText = "border:none;background:rgba(180,83,9,.12);border-radius:6px;cursor:pointer;font:700 10px system-ui;color:" + AMBER + ";padding:2px 5px";
    var rates = [1, 1.5, 2, 0.75], ri = 0; speed.textContent = "1x";
    var del = document.createElement("button"); del.type = "button"; del.title = "Delete";
    del.style.cssText = "border:none;background:transparent;cursor:pointer;display:inline-flex;align-items:center;padding:2px;color:" + AMBER + ";opacity:.5";
    del.innerHTML = trashSvg();
    del.addEventListener("mouseenter", function () { del.style.opacity = "1"; del.style.color = "#dc2626"; });
    del.addEventListener("mouseleave", function () { del.style.opacity = ".5"; del.style.color = AMBER; });
    del.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); if (!confirm("Delete this voice note?")) return; deletedUrls[href] = true; hideMessageRow(chip); });
    play.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); if (audio.paused) audio.play(); else audio.pause(); });
    audio.addEventListener("play", function () { play.innerHTML = pauseSvg(); });
    audio.addEventListener("pause", function () { play.innerHTML = playSvg(); });
    audio.addEventListener("ended", function () { play.innerHTML = playSvg(); });
    audio.addEventListener("loadedmetadata", function () { time.textContent = "0:00" + (isFinite(audio.duration) ? " / " + fmt(audio.duration) : ""); });
    audio.addEventListener("timeupdate", function () { if (audio.duration && isFinite(audio.duration)) { barFill.style.width = (audio.currentTime / audio.duration * 100) + "%"; time.textContent = fmt(audio.currentTime) + " / " + fmt(audio.duration); } else { time.textContent = fmt(audio.currentTime); } });
    barWrap.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); var r = barWrap.getBoundingClientRect(); var p = (e.clientX - r.left) / r.width; if (audio.duration && isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(1, p)) * audio.duration; });
    speed.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); ri = (ri + 1) % rates.length; audio.playbackRate = rates[ri]; speed.textContent = rates[ri] + "x"; });
    chip.appendChild(play); chip.appendChild(barWrap); chip.appendChild(time); chip.appendChild(speed); chip.appendChild(del); chip.appendChild(audio);
    return chip;
  }

  /* ═══════════════════════ UPGRADE: scan page for audio links → players ═══════════════════════ */
  function upgradeAudioComments() {
    var links = document.getElementsByTagName("a");
    for (var i = 0; i < links.length; i++) {
      var a = links[i], href = a.getAttribute && a.getAttribute("href") || "";
      if (!isAudioHref(href)) continue;
      a.style.display = "none";
      if (deletedUrls[href]) { hideMessageRow(a); continue; }
      if (chipExistsForDoc(href)) continue;
      if (inInboxList(a)) continue;
      if (a.parentNode) { a.parentNode.insertBefore(makeChip(href), a.nextSibling); }
    }
  }

  /* ═══════════════════════ RECORDING ═══════════════════════ */
  function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { renderStatus("Mic not supported", "#dc2626", 3000); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      lastStream = stream; chunks = [];
      var mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
      mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mediaRecorder.onstop = function () {
        if (lastStream) lastStream.getTracks().forEach(function (t) { t.stop(); });
        if (pendingSend) {
          var blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
          var noteText = readComposerNote(); clearComposer();
          uploadToServer(blob, true, noteText, function (t, c, ms) { renderStatus(t, c, ms); });
        } else { renderIdle(); }
      };
      mediaRecorder.start(); recording = true; pendingSend = false; startedAt = Date.now();
      renderRecording();
      timerInt = setInterval(function () { var s = Math.floor((Date.now() - startedAt) / 1000); var tm = document.getElementById("kleegr-voice-timer"); if (tm) tm.textContent = fmt(s); }, 500);
    }).catch(function (err) { renderStatus("Mic permission denied", "#dc2626", 3000); console.error("[kleegr-voice] mic error:", err); });
  }
  function stopTimer() { if (timerInt) { clearInterval(timerInt); timerInt = null; } }
  function confirmRecording() { if (!recording) return; recording = false; pendingSend = true; stopTimer(); renderStatus("Sending\u2026", "#2563eb"); try { mediaRecorder && mediaRecorder.stop(); } catch (e) {} }
  function cancelRecording() { recording = false; pendingSend = false; stopTimer(); try { mediaRecorder && mediaRecorder.stop(); } catch (e) {} renderIdle(); }

  /* ═══════════════════════ BOOT ═══════════════════════ */
  injectStyleOnce();
  resolveUserSession();
  var retryCount = 0, retryInt = setInterval(function () { if (getCachedUserId() || retryCount > 10) { clearInterval(retryInt); return; } retryCount++; resolveUserSession(); }, 3000);
  var ticking = false;
  function tick() { if (ticking) return; ticking = true; try { placeWrap(); upgradeAudioComments(); } catch (e) { console.error("[kleegr-voice] tick error:", e); } ticking = false; }
  setInterval(tick, 1000);
  tick();
})();
