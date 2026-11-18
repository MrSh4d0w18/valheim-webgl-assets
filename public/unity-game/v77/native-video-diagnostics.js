(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var enabled = false;
  try { enabled = new URLSearchParams(window.location.search).get('video_diagnostics') === '1'; } catch (_) { return; }
  if (!enabled || Object.prototype.hasOwnProperty.call(window, '__valheimVideoDiagnostics')) return;

  var MAX_EVENTS = 64, MAX_BYTES = 32768, MAX_VIDEOS = 8, SAMPLE_MS = 4000;
  var events = [], watched = [], stopped = false, reason = null, timer = null;
  var started = performance.now(), nextId = 1;
  var original = document.createElement;
  var ownDescriptor = Object.getOwnPropertyDescriptor(document, 'createElement');
  var mediaEvents = ['loadedmetadata', 'ratechange', 'playing', 'waiting', 'stalled', 'seeking', 'seeked', 'pause', 'ended', 'error', 'emptied'];
  var encoder = new TextEncoder();
  function finite(value) { return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null; }
  function visibility() {
    var value = document.visibilityState;
    return value === 'visible' || value === 'hidden' || value === 'prerender' ? value : 'unknown';
  }
  function report() {
    return { schemaVersion: 1, diagnosticOnly: true, stopped: stopped, stopReason: reason,
      maximumEvents: MAX_EVENTS, maximumBytes: MAX_BYTES, sampleIntervalMs: SAMPLE_MS, observedVideos: watched.length,
      urlsOrFormValuesCaptured: false, playbackModified: false, events: events };
  }
  function serialized() { return JSON.stringify(report()); }
  function cleanup(why) {
    if (stopped) return;
    stopped = true; reason = why;
    if (timer !== null) { window.clearInterval(timer); timer = null; }
    for (var i = 0; i < watched.length; i++) {
      var item = watched[i];
      for (var j = 0; j < item.listeners.length; j++) {
        try { item.video.removeEventListener(item.listeners[j][0], item.listeners[j][1]); } catch (_) {}
      }
      item.video = null; item.listeners = []; item.previous = null;
    }
    try { document.removeEventListener('visibilitychange', onVisibility); } catch (_) {}
    try { window.removeEventListener('pagehide', onPageHide); } catch (_) {}
    try {
      if (document.createElement === wrappedCreateElement) {
        if (ownDescriptor) Object.defineProperty(document, 'createElement', ownDescriptor);
        else delete document.createElement;
      }
    } catch (_) {}
  }
  function append(value) {
    if (stopped) return;
    if (events.length >= MAX_EVENTS) { cleanup('event-limit'); return; }
    events.push(value);
    if (encoder.encode(serialized()).length > MAX_BYTES - 256) {
      events.pop(); cleanup('byte-limit'); return;
    }
    if (events.length === MAX_EVENTS) cleanup('event-limit');
  }
  function snapshot(item, kind) {
    if (stopped) return;
    try {
      var video = item.video, now = performance.now();
      var mediaTime = finite(video.currentTime), previous = item.previous;
      var wallSeconds = previous ? (now - previous.wall) / 1000 : null;
      var mediaSeconds = previous && mediaTime !== null && previous.media !== null ? mediaTime - previous.media : null;
      var ratio = wallSeconds !== null && wallSeconds >= 0.25 && mediaSeconds !== null ? finite(mediaSeconds / wallSeconds) : null;
      var entry = { type: kind, video: item.id, wallMs: finite(now - started), mediaTime: mediaTime,
        duration: finite(video.duration), playbackRate: finite(video.playbackRate), paused: !!video.paused,
        seeking: !!video.seeking, ended: !!video.ended, readyState: finite(video.readyState),
        visibility: visibility(), wallDeltaSeconds: finite(wallSeconds), mediaDeltaSeconds: finite(mediaSeconds), mediaToWallRatio: ratio };
      if (kind === 'error') entry.errorCode = video.error ? finite(video.error.code) : null;
      item.previous = { wall: now, media: mediaTime };
      append(entry);
    } catch (_) {}
  }
  function observe(video, kind) {
    if (stopped || watched.length >= MAX_VIDEOS || !video || typeof video.addEventListener !== 'function') return;
    if (String(video.localName || video.tagName || '').toLowerCase() !== 'video') return;
    for (var i = 0; i < watched.length; i++) if (watched[i].video === video) return;
    var item = { video: video, id: nextId++, listeners: [], previous: null };
    watched.push(item);
    for (var j = 0; j < mediaEvents.length; j++) {
      (function (eventName) {
        var listener = function () { snapshot(item, eventName); };
        video.addEventListener(eventName, listener);
        item.listeners.push([eventName, listener]);
      })(mediaEvents[j]);
    }
    snapshot(item, kind);
  }
  function wrappedCreateElement() {
    // Forward the original call before observing; its this, arguments, return
    // value and any thrown exception retain the native method's behavior.
    var result = Reflect.apply(original, this, arguments);
    try { observe(result, 'created'); } catch (_) {}
    return result;
  }
  function onVisibility() {
    try { append({ type: 'visibilitychange', wallMs: finite(performance.now() - started), visibility: visibility() }); } catch (_) {}
  }
  function onPageHide() { cleanup('pagehide'); }

  try {
    document.createElement = wrappedCreateElement;
    if (document.createElement !== wrappedCreateElement) return;
    Object.defineProperty(window, '__valheimVideoDiagnostics', { configurable: true, value: function () { return serialized(); } });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    var existing = document.querySelectorAll('video');
    for (var i = 0; i < existing.length && !stopped; i++) observe(existing[i], 'already-attached');
    if (!stopped) timer = window.setInterval(function () {
      for (var j = 0; j < watched.length && !stopped; j++) {
        try { if (!watched[j].video.paused || watched[j].video.seeking) snapshot(watched[j], 'sample'); } catch (_) {}
      }
    }, SAMPLE_MS);
  } catch (_) { cleanup('observer-setup-unavailable'); }
})();
