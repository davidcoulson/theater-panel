// WebView throttle probe (see probe.html). Plain script, no modules, so it runs in old WebViews.
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var send = params.get('log') === '1';
  var framed = (function () { try { return window.top !== window; } catch (e) { return true; } })();
  var where = framed ? 'iframe' : 'top';
  var started = Date.now();
  var $ = function (id) { return document.getElementById(id); };

  // The real visibility, read from Document.prototype: a kiosk app may redefine document.hidden /
  // visibilityState on the document itself so the page keeps hearing "visible".
  var stateGetter = (function () {
    for (var o = Object.getPrototypeOf(document); o; o = Object.getPrototypeOf(o)) {
      var d = Object.getOwnPropertyDescriptor(o, 'visibilityState');
      if (d && d.get) return d.get;
    }
    return null;
  })();
  var realVis = function () { try { return stateGetter ? stateGetter.call(document) : document.visibilityState; } catch (e) { return '?'; } };

  // ---- timeline ----
  var KEY = 'probe-log-' + where;
  var lines = [];
  try { lines = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { lines = []; }
  var stamp = function () { var d = new Date(); return d.toTimeString().slice(0, 8); };
  var sent = [];
  function log(kind, msg, important) {
    var line = stamp() + '  ' + kind.padEnd(10) + ' ' + msg;
    lines.push(line); if (lines.length > 400) lines.splice(0, lines.length - 400);
    try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch (e) { /* private mode */ }
    $('log').textContent = lines.slice().reverse().join('\n');
    if (send && important !== false) {
      var now = Date.now();
      sent = sent.filter(function (t) { return now - t < 60000; });
      if (sent.length < 10) {
        sent.push(now);
        fetch('/api/client-log', { method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true,
          body: JSON.stringify({ kind: 'probe', page: where, message: kind + ': ' + msg }) }).catch(function () {});
      }
    }
  }
  $('clear').onclick = function () { lines = []; try { localStorage.removeItem(KEY); } catch (e) {} log('cleared', 'timeline cleared', false); };

  var ua = navigator.userAgent;
  var chrome = (ua.match(/Chrome\/([\d.]+)/) || [])[1] || '?';
  $('meta').textContent = where.toUpperCase() + ' · ' + location.origin + ' · Chrome/WebView ' + chrome +
    (framed ? '' : ' · kiosk mask: ' + (typeof window.__ksVisibilityMasked === 'undefined' ? 'not present' : 'present')) +
    ' · loaded ' + new Date(started).toLocaleTimeString();
  log('start', where + ', visibility ' + realVis() + ' (reported ' + document.visibilityState + '), Chrome ' + chrome);

  // ---- measurements ----
  var m = { timer: 0, timerMax: 0, frameAt: performance.now(), frameGap: 0, frameMax: 0, drift: 0, driftMax: 0, inView: null, fetch: null, fetchMax: 0 };
  var cls = function (ms, warn, bad) { return ms >= bad ? 'bad' : ms >= warn ? 'warn' : 'ok'; };
  var set = function (id, text, c) { var el = $(id); el.textContent = text; if (c) el.className = c; };

  // A 0 ms timer, every 2 s: how late it actually runs.
  setInterval(function () {
    var t0 = performance.now();
    setTimeout(function () {
      var lag = Math.round(performance.now() - t0);
      m.timer = lag; if (lag > m.timerMax) m.timerMax = lag;
      if (lag > 1000) log('timer', '0 ms timer ran ' + lag + ' ms late (visibility ' + realVis() + ')');
    }, 0);
  }, 2000);

  // Frames: the gap between animation frames. A hidden page gets none at all.
  (function frame() {
    requestAnimationFrame(function () {
      var now = performance.now(), gap = now - m.frameAt;
      m.frameAt = now; m.frameGap = Math.round(gap);
      if (gap > m.frameMax) m.frameMax = Math.round(gap);
      if (gap > 1000) log('frame', 'no frame for ' + Math.round(gap) + ' ms (visibility ' + realVis() + ')');
      frame();
    });
  })();

  // A 1 s interval: how far it drifts. Chromium's intensive throttling stretches it to a minute.
  var last = performance.now();
  setInterval(function () {
    var now = performance.now(), drift = Math.round(now - last - 1000);
    last = now; m.drift = drift; if (drift > m.driftMax) m.driftMax = drift;
    if (drift > 1500) log('interval', '1 s interval fired ' + (drift + 1000) + ' ms apart (visibility ' + realVis() + ')');
    render();
  }, 1000);

  // Is the page itself on screen (for an iframe: is the frame in the viewport and not hidden)?
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      var r = es[es.length - 1].intersectionRatio;
      var now = r > 0;
      if (m.inView !== null && now !== m.inView) log('onscreen', now ? 'back on screen' : 'left the screen (ratio ' + r.toFixed(2) + ')');
      m.inView = now;
    }, { threshold: [0, 0.01, 1] }).observe(document.body);
  }

  // The network, for comparison: a small same-origin request every 10 s.
  setInterval(function () {
    var t0 = performance.now();
    fetch(location.pathname + '?ping=' + Date.now(), { cache: 'no-store' }).then(function () {
      var ms = Math.round(performance.now() - t0);
      m.fetch = ms; if (ms > m.fetchMax) m.fetchMax = ms;
      if (ms > 3000) log('fetch', 'round trip ' + ms + ' ms');
    }, function (e) { log('fetch', 'failed: ' + e.message); });
  }, 10000);

  // ---- lifecycle events ----
  document.addEventListener('visibilitychange', function () { log('visibility', realVis() + ' (reported ' + document.visibilityState + ')'); }, true);
  document.addEventListener('freeze', function () { log('freeze', 'page frozen by the browser'); });
  document.addEventListener('resume', function () { log('resume', 'page resumed after a freeze'); });
  addEventListener('pageshow', function (e) { log('pageshow', e.persisted ? 'from back-forward cache' : 'loaded', false); });
  addEventListener('pagehide', function () { log('pagehide', 'page hidden/unloading'); });
  addEventListener('focus', function () { log('focus', 'window focused', false); });
  addEventListener('blur', function () { log('blur', 'window lost focus', false); });
  addEventListener('online', function () { log('online', 'network online'); });
  addEventListener('offline', function () { log('offline', 'network offline'); });

  // A heartbeat every 10 minutes with the worst of each since the last one, so a quiet log
  // still proves the probe is alive (and says what "normal" looks like on this device).
  setInterval(function () {
    log('summary', 'worst in 10 min: timer ' + m.timerMax + ' ms, frame gap ' + m.frameMax + ' ms, interval drift ' + m.driftMax +
      ' ms, fetch ' + m.fetchMax + ' ms; visibility ' + realVis() + ', on screen ' + m.inView);
    m.timerMax = m.frameMax = m.driftMax = m.fetchMax = 0;
  }, 600000);

  function render() {
    var v = realVis();
    set('vis', v, v === 'visible' ? 'ok' : 'bad');
    $('visRep').textContent = 'page is told: ' + document.visibilityState + (framed ? '' : (window.__ksVisibilityMasked ? ' (masked)' : ''));
    set('timer', m.timer + ' ms', cls(m.timer, 100, 1000)); $('timerMax').textContent = 'worst ' + m.timerMax + ' ms';
    var since = Math.round(performance.now() - m.frameAt), gap = Math.max(m.frameGap, since);
    set('frame', gap + ' ms', cls(gap, 100, 1000)); $('frameMax').textContent = 'worst ' + m.frameMax + ' ms';
    set('drift', m.drift + ' ms', cls(m.drift, 200, 1500)); $('driftMax').textContent = 'worst ' + m.driftMax + ' ms';
    set('inview', m.inView === null ? '?' : m.inView ? 'yes' : 'no', m.inView === false ? 'bad' : 'ok');
    $('focus').textContent = document.hasFocus() ? 'focused' : 'not focused';
    set('fetch', m.fetch == null ? '-' : m.fetch + ' ms', m.fetch == null ? '' : cls(m.fetch, 500, 3000)); $('fetchMax').textContent = 'worst ' + m.fetchMax + ' ms';
  }
  render();
})();
