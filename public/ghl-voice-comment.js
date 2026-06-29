/**
 * Kleegr — Voice Notes + File Attachments for GHL Internal Comments
 * Version 45 — Find audio from GHL native player (video/audio elements), not just <a> tags.
 * Audio URL is in attachments array (clean preview), our script replaces GHL's native player.
 */
(function kleegrVoiceComment(){
  "use strict";
  var ENDPOINT="https://kleegr-voice-comments.vercel.app/api/internal-comment";
  var DECRYPT_ENDPOINT="https://kleegr-voice-comments.vercel.app/api/decrypt-session";
  var APP_ID="69d29cd45ed1d5be94e6e582";
  var VERSION=45;
  if(window.__kleegrVoiceCommentInstalled===VERSION)return;
  window.__kleegrVoiceCommentInstalled=VERSION;
  console.log("[kleegr-voice] v"+VERSION+" loaded");

  var recording=false,pendingSend=false,mediaRecorder=null,chunks=[],timerInt=null,startedAt=0,lastStream=null;
  var stagedFile=null,stagedVoice=null;

  function getLocationId(){var m=(location.pathname||"").match(/\/v2\/location\/([a-zA-Z0-9]+)/);return m?m[1]:"";}
  function getConversationId(){var seg=(location.pathname||"").split("/v2/location/")[1];if(seg){var p=seg.split("/");if(p[1]==="conversations"&&p[2]==="conversations"&&p[3])return p[3];}return"";}
  function getContactId(){var seg=(location.pathname||"").split("/v2/location/")[1];if(seg){var p=seg.split("/");if(p[1]==="contacts"&&p[2]==="detail"&&p[3])return p[3];}var a=document.querySelector('a[href*="/contacts/detail/"]');if(a){var m=a.getAttribute("href").match(/\/contacts\/detail\/([A-Za-z0-9]+)/);if(m)return m[1];}return"";}

  var USERID_KEY="kleegr_voice_ghl_user_id",_resolving=false;
  function getCachedUserId(){try{return localStorage.getItem(USERID_KEY)||""}catch(e){return""}}
  function cacheUserId(u){try{localStorage.setItem(USERID_KEY,u)}catch(e){}}
  function resolveUserSession(){if(getCachedUserId()||_resolving)return;if(typeof window.exposeSessionDetails!=="function")return;_resolving=true;try{window.exposeSessionDetails(APP_ID).then(function(enc){if(!enc){_resolving=false;return;}fetch(DECRYPT_ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({encryptedData:enc})}).then(function(r){return r.json()}).then(function(d){_resolving=false;if(d&&d.userId)cacheUserId(d.userId)}).catch(function(){_resolving=false})}).catch(function(){_resolving=false})}catch(e){_resolving=false}}

  function micSvg(c){return '<svg width="21" height="21" viewBox="0 0 24 24" fill="'+c+'"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2Z"/></svg>';}
  function clipSvg(c){return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="'+c+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';}
  function checkSvg(c){return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="'+c+'" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';}
  function xSvg(c){return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="'+c+'" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';}
  function playSvg(){return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';}
  function pauseSvg(){return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';}
  function sendSvg(c){return '<svg width="16" height="16" viewBox="0 0 24 24" fill="'+c+'"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>';}
  function fmt(s){s=Math.floor(s||0);return Math.floor(s/60)+":"+String(s%60).padStart(2,"0");}
  var AMBER="#b45309",AMBER_BG="#fff8e1",AMBER_BD="#f59e0b";

  function injectStyleOnce(){if(document.getElementById("kleegr-voice-style"))return;var s=document.createElement("style");s.id="kleegr-voice-style";s.textContent=['a[href$=".webm"],a[href$=".ogg"],a[href$=".oga"],a[href$=".mp3"],a[href$=".m4a"],a[href$=".wav"]{display:none!important}','.klg-wave{display:inline-flex;align-items:center;gap:2px;height:16px}','.klg-wave i{display:inline-block;width:2px;height:5px;background:'+AMBER+';border-radius:1px;animation:klgwave .9s ease-in-out infinite}','.klg-wave i:nth-child(2){animation-delay:.12s}.klg-wave i:nth-child(3){animation-delay:.24s}.klg-wave i:nth-child(4){animation-delay:.36s}.klg-wave i:nth-child(5){animation-delay:.48s}','@keyframes klgwave{0%,100%{height:5px}50%{height:15px}}','.klg-dropzone{position:absolute;inset:0;background:rgba(180,83,9,.08);border:2px dashed '+AMBER_BD+';border-radius:8px;display:flex;align-items:center;justify-content:center;font:600 14px system-ui;color:'+AMBER+';z-index:999;pointer-events:none}','.klg-staged{display:flex;align-items:center;gap:6px;padding:4px 10px;margin:4px 0;border-radius:8px;background:'+AMBER_BG+';border:1px solid '+AMBER_BD+';font:500 12px system-ui;color:'+AMBER+'}','.klg-staged-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}'].join("");document.head.appendChild(s);}

  function isVisible(el){if(!el)return false;if(el.offsetParent!==null)return true;var r=el.getClientRects();return!!(r&&r.length);}
  function escHtml(s){var d=document.createElement("div");d.textContent=s;return d.innerHTML;}
  function activeInternalInput(){var inputs=document.querySelectorAll("textarea,[contenteditable='true']");for(var i=0;i<inputs.length;i++){var el=inputs[i];if(!isVisible(el))continue;var ph=el.getAttribute?(el.getAttribute("placeholder")||el.getAttribute("data-placeholder")||el.getAttribute("aria-label")||""):"";if(!/internal comment/i.test(ph))continue;if(el.getBoundingClientRect().height<60)return null;return el;}return null;}
  function readComposerNote(){var el=activeInternalInput();if(!el)return"";var t=(el.tagName==="TEXTAREA"||el.tagName==="INPUT")?(el.value||""):(el.textContent||"");return(t||"").trim();}
  function clearComposer(){var el=activeInternalInput();if(!el)return;try{if(el.tagName==="TEXTAREA"||el.tagName==="INPUT"){var p=el.tagName==="TEXTAREA"?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;var s=Object.getOwnPropertyDescriptor(p,"value");if(s&&s.set){s.set.call(el,"");el.dispatchEvent(new Event("input",{bubbles:true}))}}else{el.textContent="";el.dispatchEvent(new Event("input",{bubbles:true}))}}catch(e){}}
  function footerFrom(el){var card=el;for(var j=0;j<9&&card;j++){var send=card.querySelector("#conv-send-button-simple,[data-testid='send-button'],.conv-send-button,button[type='submit'],[id*='send-button']");if(send){var bar=send.parentElement;for(var k=0;k<5&&bar;k++){if(bar.children&&bar.children.length>=2)return bar;bar=bar.parentElement;}return send.parentElement;}card=card.parentElement;}return null;}
  function inInboxList(el){var node=el;for(var i=0;i<12&&node;i++){if(node.querySelectorAll){var rows=node.querySelectorAll('a[href*="/conversations/conversations/"]');if(rows.length>=3)return true;}node=node.parentElement;}return false;}
  function scrollToBottom(){var divs=document.querySelectorAll('div');for(var j=0;j<divs.length;j++){var d=divs[j];if(d.scrollHeight>d.clientHeight+200&&d.clientHeight>300&&d.clientHeight<window.innerHeight){d.scrollTop=d.scrollHeight;return;}}}

  function uploadToServer(file,isVoice,noteText,statusCb){
    var cid=getConversationId(),ctid=getContactId(),lid=getLocationId();
    if(!cid&&!ctid){if(statusCb)statusCb("Can\u2019t find contact","#dc2626",5000);return;}
    var fd=new FormData();fd.append("file",file,file.name||(isVoice?"voice-note.webm":"attachment"));
    if(ctid)fd.append("contactId",ctid);if(cid)fd.append("conversationId",cid);if(lid)fd.append("locationId",lid);
    if(noteText)fd.append("note",noteText);if(!isVoice)fd.append("fileName",file.name||"attachment");
    var uid=getCachedUserId();if(uid)fd.append("userId",uid);
    if(statusCb)statusCb("Uploading\u2026","#2563eb");
    fetch(ENDPOINT,{method:"POST",body:fd}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(res){if(res.j&&res.j.success){if(statusCb)statusCb("Posted \u2713","#15803d",2500);[500,1500,3000,5000].forEach(function(d){setTimeout(function(){try{scrollToBottom();upgradeAudioComments()}catch(e){}},d)})}else{var msg=(res.j&&res.j.error)?String(res.j.error).slice(0,80):"error";if(statusCb)statusCb("Failed: "+msg,"#dc2626",6000)}}).catch(function(){if(statusCb)statusCb("Network error","#dc2626",5000)});
  }

  function showStagedBar(icon,name,sz,onSend,onRm){removeStagedBar();var input=activeInternalInput();if(!input)return;var bar=document.createElement("div");bar.id="kleegr-staged-bar";bar.className="klg-staged";bar.innerHTML='<span>'+icon+'</span><span class="klg-staged-name">'+escHtml(name)+'</span><span style="opacity:.6;font-size:11px">'+sz+'</span>';var rm=document.createElement("button");rm.type="button";rm.style.cssText="border:none;background:transparent;cursor:pointer;color:#dc2626;font:700 14px system-ui;padding:2px 4px";rm.textContent="\u2715";rm.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();onRm()});var sb=document.createElement("button");sb.type="button";sb.style.cssText="border:none;background:"+AMBER+";color:white;border-radius:50%;width:26px;height:26px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0";sb.innerHTML=sendSvg("white");sb.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();onSend()});bar.appendChild(rm);bar.appendChild(sb);var footer=footerFrom(input);if(footer&&footer.parentElement)footer.parentElement.insertBefore(bar,footer);else input.parentElement.insertBefore(bar,input.nextSibling);}
  function removeStagedBar(){var b=document.getElementById("kleegr-staged-bar");if(b)b.remove()}
  function showStagedFile(file){stagedFile=file;stagedVoice=null;var sz=file.size>1048576?(file.size/1048576).toFixed(1)+" MB":(file.size/1024).toFixed(0)+" KB";showStagedBar("\uD83D\uDCCE",file.name,sz,function(){if(!stagedFile)return;var f=stagedFile,n=readComposerNote();stagedFile=null;removeStagedBar();clearComposer();uploadToServer(f,false,n,function(t,c,ms){renderStatus(t,c,ms)})},function(){stagedFile=null;removeStagedBar()})}
  function showStagedVoice(blob,dur){stagedVoice=blob;stagedFile=null;showStagedBar("\uD83C\uDFA4","Voice note",fmt(dur),function(){if(!stagedVoice)return;var b=stagedVoice,n=readComposerNote();stagedVoice=null;removeStagedBar();clearComposer();uploadToServer(b,true,n,function(t,c,ms){renderStatus(t,c,ms)})},function(){stagedVoice=null;removeStagedBar();renderIdle()})}

  function wrap(){return document.getElementById("kleegr-voice-wrap")}
  function clipEl(){return document.getElementById("kleegr-clip-wrap")}
  function renderIdle(target){var w=target||wrap();if(!w)return;w.innerHTML="";var btn=document.createElement("button");btn.type="button";btn.style.cssText="display:inline-flex;align-items:center;justify-content:center;height:34px;width:34px;border:none;border-radius:50%;background:transparent;cursor:pointer;";btn.innerHTML=micSvg(AMBER);btn.addEventListener("mouseenter",function(){btn.style.background="rgba(180,83,9,0.10)"});btn.addEventListener("mouseleave",function(){btn.style.background="transparent"});btn.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();startRecording()});w.appendChild(btn)}
  function renderRecording(){var w=wrap();if(!w)return;w.innerHTML='<span style="display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 10px;border-radius:18px;background:'+AMBER_BG+';border:1px solid '+AMBER_BD+';color:'+AMBER+';font:600 12px system-ui,sans-serif"><span style="width:8px;height:8px;border-radius:50%;background:#dc2626;display:inline-block"></span><span class="klg-wave"><i></i><i></i><i></i><i></i><i></i></span><span id="kleegr-voice-timer">0:00</span><span id="kleegr-voice-cancel" style="cursor:pointer;display:inline-flex;padding:2px">'+xSvg(AMBER)+'</span><span id="kleegr-voice-done" style="cursor:pointer;display:inline-flex;padding:2px">'+checkSvg("#15803d")+'</span></span>';document.getElementById("kleegr-voice-cancel").addEventListener("click",function(e){e.preventDefault();e.stopPropagation();cancelRecording()});document.getElementById("kleegr-voice-done").addEventListener("click",function(e){e.preventDefault();e.stopPropagation();finishRecording()})}
  function renderStatus(text,color,ms){var w=wrap();if(!w)return;w.innerHTML='<span style="display:inline-flex;align-items:center;height:34px;padding:0 12px;border-radius:18px;background:'+AMBER_BG+';border:1px solid '+AMBER_BD+';color:'+(color||AMBER)+';font:600 12px system-ui,sans-serif;max-width:340px">'+text+'</span>';if(ms)setTimeout(function(){if(!recording&&wrap())renderIdle()},ms)}
  function renderClip(target){var w=target||clipEl();if(!w)return;w.innerHTML="";var btn=document.createElement("button");btn.type="button";btn.style.cssText="display:inline-flex;align-items:center;justify-content:center;height:34px;width:34px;border:none;border-radius:50%;background:transparent;cursor:pointer;";btn.innerHTML=clipSvg(AMBER);btn.addEventListener("mouseenter",function(){btn.style.background="rgba(180,83,9,0.10)"});btn.addEventListener("mouseleave",function(){btn.style.background="transparent"});btn.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();var inp=document.createElement("input");inp.type="file";inp.multiple=false;inp.style.cssText="position:fixed;top:-9999px;opacity:0";document.body.appendChild(inp);inp.addEventListener("change",function(){if(inp.files&&inp.files[0])showStagedFile(inp.files[0]);inp.remove()});setTimeout(function(){if(document.body.contains(inp))inp.remove()},120000);inp.click()});w.appendChild(btn)}

  function setupDragDrop(){var input=activeInternalInput();if(!input)return;var footer=footerFrom(input);if(!footer)return;var card=footer.parentElement;if(!card||card.getBoundingClientRect().height>400||card.__klgDrop45)return;card.__klgDrop45=true;card.style.position="relative";var ov=null;card.addEventListener("dragenter",function(e){e.preventDefault();e.stopPropagation();if(!ov){ov=document.createElement("div");ov.className="klg-dropzone";ov.textContent="Drop file to attach";card.appendChild(ov)}});card.addEventListener("dragover",function(e){e.preventDefault();e.stopPropagation()});card.addEventListener("dragleave",function(e){if(ov&&!card.contains(e.relatedTarget)){ov.remove();ov=null}});card.addEventListener("drop",function(e){e.preventDefault();e.stopPropagation();if(ov){ov.remove();ov=null}var f=e.dataTransfer&&e.dataTransfer.files;if(f&&f.length)showStagedFile(f[0])})}

  function placeWrap(){if(recording)return;var w=wrap(),cw=clipEl(),input=activeInternalInput();if(!input){if(w)w.remove();if(cw)cw.remove();return}var footer=footerFrom(input);if(!footer){if(w)w.remove();if(cw)cw.remove();return}if(!w){w=document.createElement("span");w.id="kleegr-voice-wrap";w.style.cssText="display:inline-flex;align-items:center;vertical-align:middle";renderIdle(w)}if(!cw){cw=document.createElement("span");cw.id="kleegr-clip-wrap";cw.style.cssText="display:inline-flex;align-items:center;vertical-align:middle";renderClip(cw)}if(w.parentNode!==footer){try{footer.insertBefore(w,footer.firstChild)}catch(e){}}if(cw.parentNode!==footer){try{footer.insertBefore(cw,w.nextSibling)}catch(e){}}setupDragDrop()}

  /* AUDIO PLAYER */
  var AUDIO_EXT_RE=/\.(webm|ogg|oga|mp3|m4a|wav)(\?|$)/i;
  function isAudioHref(href){return href&&AUDIO_EXT_RE.test(href)}
  function chipExistsForDoc(href){var auds=document.querySelectorAll("audio.klg-audio");for(var i=0;i<auds.length;i++){if(auds[i].getAttribute("src")===href)return true}return false}
  function makeChip(href){
    var chip=document.createElement("span");chip.className="klg-audio-chip";
    chip.style.cssText="display:inline-flex;align-items:center;gap:8px;vertical-align:middle;margin-left:4px";
    var audio=document.createElement("audio");audio.className="klg-audio";audio.src=href;audio.preload="metadata";
    var play=document.createElement("button");play.type="button";
    play.style.cssText="border:none;background:rgba(180,83,9,.15);border-radius:50%;width:26px;height:26px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;color:"+AMBER;
    play.innerHTML=playSvg();
    var barW=document.createElement("span");barW.style.cssText="position:relative;width:96px;height:4px;background:rgba(180,83,9,.25);border-radius:2px;cursor:pointer;flex:0 0 auto";
    var barF=document.createElement("span");barF.style.cssText="position:absolute;left:0;top:0;height:100%;width:0%;background:"+AMBER+";border-radius:2px";barW.appendChild(barF);
    var time=document.createElement("span");time.style.cssText="font:600 11px system-ui;color:"+AMBER+";white-space:nowrap";time.textContent="0:00";
    var speed=document.createElement("button");speed.type="button";
    speed.style.cssText="border:none;background:rgba(180,83,9,.12);border-radius:6px;cursor:pointer;font:700 10px system-ui;color:"+AMBER+";padding:2px 5px";
    var rates=[1,1.5,2,0.75],ri=0;speed.textContent="1x";
    play.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();if(audio.paused)audio.play();else audio.pause()});
    audio.addEventListener("play",function(){play.innerHTML=pauseSvg()});
    audio.addEventListener("pause",function(){play.innerHTML=playSvg()});
    audio.addEventListener("ended",function(){play.innerHTML=playSvg()});
    audio.addEventListener("loadedmetadata",function(){time.textContent="0:00"+(isFinite(audio.duration)?" / "+fmt(audio.duration):"")});
    audio.addEventListener("timeupdate",function(){if(audio.duration&&isFinite(audio.duration)){barF.style.width=(audio.currentTime/audio.duration*100)+"%";time.textContent=fmt(audio.currentTime)+" / "+fmt(audio.duration)}else{time.textContent=fmt(audio.currentTime)}});
    barW.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();var r=barW.getBoundingClientRect();var p=(e.clientX-r.left)/r.width;if(audio.duration&&isFinite(audio.duration))audio.currentTime=Math.max(0,Math.min(1,p))*audio.duration});
    speed.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();ri=(ri+1)%rates.length;audio.playbackRate=rates[ri];speed.textContent=rates[ri]+"x"});
    chip.appendChild(play);chip.appendChild(barW);chip.appendChild(time);chip.appendChild(speed);chip.appendChild(audio);
    return chip;
  }

  function upgradeAudioComments(){
    // 1. Find <a> tags with audio extensions (old-style: URL in text)
    var links=document.getElementsByTagName("a");
    for(var i=0;i<links.length;i++){
      var a=links[i],href=a.getAttribute&&a.getAttribute("href")||"";
      if(!isAudioHref(href))continue;
      a.style.display="none";
      if(chipExistsForDoc(href))continue;
      if(inInboxList(a))continue;
      if(a.parentNode)a.parentNode.insertBefore(makeChip(href),a.nextSibling);
    }

    // 2. Find <video> and <audio> elements with audio src (new-style: URL in attachments)
    //    GHL renders native media players for attachment audio files.
    //    We hide the native player and its container, then insert our amber chip.
    var mediaEls=document.querySelectorAll("video[src],audio[src],video source[src],audio source[src]");
    for(var j=0;j<mediaEls.length;j++){
      var mel=mediaEls[j];
      var msrc=mel.getAttribute("src")||""; 
      if(!isAudioHref(msrc))continue;
      if(chipExistsForDoc(msrc))continue;
      if(inInboxList(mel))continue;
      // Find the native player container (walk up to find a reasonably-sized wrapper)
      var container=mel;
      for(var k=0;k<8&&container;k++){
        var h=container.getBoundingClientRect().height;
        if(h>40&&h<300){break;}
        container=container.parentElement;
      }
      if(container&&container!==document.body){
        container.style.display="none";
        // Insert our player after the hidden container
        if(container.parentNode){
          container.parentNode.insertBefore(makeChip(msrc),container.nextSibling);
        }
      }
    }

    // 3. Also check for <video> without src but with child <source> elements
    var videos=document.querySelectorAll("video");
    for(var v=0;v<videos.length;v++){
      var vid=videos[v];
      if(vid.__klgChecked45)continue;
      var vsrc=vid.getAttribute("src")||"";  
      if(!vsrc){
        var sources=vid.querySelectorAll("source");
        for(var ss=0;ss<sources.length;ss++){vsrc=sources[ss].getAttribute("src")||"";if(vsrc)break;}
      }
      if(!vsrc)vsrc=vid.currentSrc||"";
      if(!isAudioHref(vsrc))continue;
      if(chipExistsForDoc(vsrc))continue;
      if(inInboxList(vid))continue;
      vid.__klgChecked45=true;
      var vc=vid;
      for(var vk=0;vk<8&&vc;vk++){
        var vh=vc.getBoundingClientRect().height;
        if(vh>40&&vh<300){break;}
        vc=vc.parentElement;
      }
      if(vc&&vc!==document.body){
        vc.style.display="none";
        if(vc.parentNode)vc.parentNode.insertBefore(makeChip(vsrc),vc.nextSibling);
      }
    }
  }

  function startRecording(){if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){renderStatus("Mic not supported","#dc2626",3000);return}navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){lastStream=stream;chunks=[];var mime=MediaRecorder.isTypeSupported("audio/webm;codecs=opus")?"audio/webm;codecs=opus":(MediaRecorder.isTypeSupported("audio/webm")?"audio/webm":"");mediaRecorder=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream);mediaRecorder.ondataavailable=function(e){if(e.data&&e.data.size)chunks.push(e.data)};mediaRecorder.onstop=function(){if(lastStream)lastStream.getTracks().forEach(function(t){t.stop()});if(pendingSend){var blob=new Blob(chunks,{type:mediaRecorder.mimeType||"audio/webm"});showStagedVoice(blob,Math.floor((Date.now()-startedAt)/1000))}else{renderIdle()}};mediaRecorder.start();recording=true;pendingSend=false;startedAt=Date.now();renderRecording();timerInt=setInterval(function(){var s=Math.floor((Date.now()-startedAt)/1000);var tm=document.getElementById("kleegr-voice-timer");if(tm)tm.textContent=fmt(s)},500)}).catch(function(){renderStatus("Mic denied","#dc2626",3000)})}
  function stopTimer(){if(timerInt){clearInterval(timerInt);timerInt=null}}
  function finishRecording(){if(!recording)return;recording=false;pendingSend=true;stopTimer();try{mediaRecorder&&mediaRecorder.stop()}catch(e){}}
  function cancelRecording(){recording=false;pendingSend=false;stopTimer();try{mediaRecorder&&mediaRecorder.stop()}catch(e){}renderIdle()}

  injectStyleOnce();resolveUserSession();
  var rc=0,ri2=setInterval(function(){if(getCachedUserId()||rc>10){clearInterval(ri2);return}rc++;resolveUserSession()},3000);
  var ticking=false;function tick(){if(ticking)return;ticking=true;try{placeWrap();upgradeAudioComments()}catch(e){console.error("[kleegr-voice]",e)}ticking=false}setInterval(tick,1000);tick();
})();
