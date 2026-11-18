(function (root) {
  "use strict";
  var KEY = "__valheimAudioRateObservation";
  if (Object.prototype.hasOwnProperty.call(root, KEY)) return;
  var MAX_RECORDS = 32, MAX_FRAMES = 8, MAX_STACK_CHARS = 1024, COUNTER_CAP = 1000000000;
  var state = { installed: false, rejectedAttempts: 0, droppedRejections: 0, records: [] };
  var proto, original, wrapper, readers, elements = new WeakMap(), nextElementId = 1;
  function increment(name) { state[name] = Math.min(COUNTER_CAP, state[name] + 1); }
  function number(value) {
    if (typeof value !== "number") return { kind: typeof value };
    if (Number.isFinite(value)) return { kind: "number", value: value };
    return { kind: "number", nonfinite: Number.isNaN(value) ? "NaN" : value < 0 ? "-Infinity" : "Infinity" };
  }
  function getter(start, name) {
    for (var p = start; p; p = Object.getPrototypeOf(p)) {
      var descriptor = Object.getOwnPropertyDescriptor(p, name);
      if (descriptor) return typeof descriptor.get === "function" ? descriptor.get : null;
    }
    return null;
  }
  function read(element, name) {
    try {
      var value = readers[name] ? Reflect.apply(readers[name], element, []) : null;
      return typeof value === "number" ? number(value) : typeof value === "boolean" ? value : "unavailable";
    } catch (_) { return "unavailable"; }
  }
  function boundedStack() {
    // Never retain source URLs, origins, paths, query strings, or arbitrary stack text.
    var stack = new Error().stack;
    if (typeof stack !== "string") return [];
    var lines = stack.slice(0, 8192).split("\n"), frames = [], length = 0;
    for (var i = 1; i < lines.length && frames.length < MAX_FRAMES; i++) {
      var line = lines[i], wasm = line.match(/wasm-function\[\d+\](?::0x[0-9a-f]+)?/i), frame;
      if (wasm) frame = wasm[0];
      else {
        var fn = line.match(/^\s*at\s+([A-Za-z_$][A-Za-z0-9_$.<> ]{0,90})(?:\s|\()/);
        var position = line.match(/:(\d+):(\d+)\)?\s*$/);
        if (!fn && !position) continue;
        frame = (fn ? fn[1].trim() : "<script>") + (position ? ":" + position[1] + ":" + position[2] : "");
      }
      if (length + frame.length > MAX_STACK_CHARS) break;
      frames.push(frame); length += frame.length;
    }
    return frames;
  }
  function record(element, attempted) {
    if (!state.installed) return;
    increment("rejectedAttempts");
    if (state.records.length >= MAX_RECORDS) { increment("droppedRejections"); return; }
    var id = elements.get(element);
    if (!id) { id = nextElementId++; elements.set(element, id); }
    var documentState = { visibility: "unavailable", hasFocus: "unavailable" };
    try {
      var doc = root.document;
      if (doc && (doc.visibilityState === "visible" || doc.visibilityState === "hidden")) documentState.visibility = doc.visibilityState;
      if (doc && typeof doc.hasFocus === "function") documentState.hasFocus = !!doc.hasFocus();
    } catch (_) { }
    state.records.push({
      sequence: state.rejectedAttempts, observationElementId: id, result: "nativeSetterThrew",
      attemptedPlaybackRate: number(attempted), playbackRateAfterRejection: read(element, "playbackRate"),
      pausedAfterRejection: read(element, "paused"), currentTimeAfterRejection: read(element, "currentTime"),
      durationAfterRejection: read(element, "duration"), loopAfterRejection: read(element, "loop"),
      readyStateAfterRejection: read(element, "readyState"), documentState: documentState, callerFrames: boundedStack()
    });
  }
  function install(options) {
    if (!options || options.optIn !== true) return { installed: false, reason: "explicit opt-in required" };
    if (!root.HTMLMediaElement || !root.HTMLMediaElement.prototype) return { installed: false, reason: "HTMLMediaElement absent" };
    proto = root.HTMLMediaElement.prototype;
    var existing = Object.getOwnPropertyDescriptor(proto, "playbackRate");
    if (state.installed) {
      if (existing && existing.set === wrapper && existing.get === original.get)
        return { installed: true, alreadyInstalled: true };
      state.installed = false;
      return { installed: false, reason: "foreign descriptor retained" };
    }
    if (original && (!existing || existing.set !== original.set || existing.get !== original.get ||
      existing.enumerable !== original.enumerable || existing.configurable !== original.configurable))
      return { installed: false, reason: "foreign descriptor retained" };
    original = existing;
    if (!original || !original.configurable || typeof original.get !== "function" || typeof original.set !== "function")
      return { installed: false, reason: "native descriptor not configurable" };
    readers = {};
    ["playbackRate", "paused", "currentTime", "duration", "loop", "readyState"].forEach(function (name) { readers[name] = getter(proto, name); });
    var nativeSetter = original.set;
    wrapper = function (value) {
      try { return Reflect.apply(nativeSetter, this, [value]); }
      catch (error) {
        try { record(this, value); } catch (_) { }
        throw error;
      }
    };
    Object.defineProperty(proto, "playbackRate", {
      get: original.get, set: wrapper, enumerable: original.enumerable, configurable: original.configurable
    });
    state.installed = true;
    return { installed: true, protocol: 1, maximumRecords: MAX_RECORDS };
  }
  function uninstall() {
    if (!state.installed) return { installed: false, restored: false };
    var current = Object.getOwnPropertyDescriptor(proto, "playbackRate");
    state.installed = false;
    if (!current || current.set !== wrapper || current.get !== original.get || current.enumerable !== original.enumerable || current.configurable !== original.configurable)
      return { installed: false, restored: false, reason: "foreign descriptor retained" };
    Object.defineProperty(proto, "playbackRate", original);
    return { installed: false, restored: true };
  }
  function snapshot() {
    return JSON.parse(JSON.stringify({ protocol: 1, installed: state.installed,
      scope: "only rejected native playbackRate assignments; observation IDs are not Unity/channel identities",
      rejectedAttempts: state.rejectedAttempts, droppedRejections: state.droppedRejections,
      limits: { records: MAX_RECORDS, stackFramesEach: MAX_FRAMES, stackCharactersEach: MAX_STACK_CHARS }, records: state.records }));
  }
  Object.defineProperty(root, KEY, { configurable: true, enumerable: false, writable: false,
    value: Object.freeze({ install: install, uninstall: uninstall, snapshot: snapshot }) });
})(typeof globalThis !== "undefined" ? globalThis : this);
