/* B站弹幕两态化 · 控制台速用版
 * 打开任意 B 站视频页 -> F12 -> Console -> 贴进来 -> 回车
 * 效果：干掉“精简弹幕”中间态，弹幕开关只剩 开启 / 关闭。
 * 想长期生效请用同目录的 bilibili-danmaku-2state.user.js（油猴/篡改猴）。
 */
(function () {
  var KEY = 'dm_three_state_switch';

  function pin(o) {
    if (!o) return o;
    try {
      Object.defineProperty(o, KEY, {
        configurable: true, enumerable: true,
        get: function () { return false; }, set: function () {}
      });
    } catch (e) { try { o[KEY] = false; } catch (e2) {} }
    return o;
  }

  ['webAbTest', 'abtest'].forEach(function (n) {
    var v;
    try { var d = Object.getOwnPropertyDescriptor(window, n); if (d) v = d.value; } catch (e) {}
    pin(v);
    try {
      Object.defineProperty(window, n, {
        configurable: true,
        get: function () { return v; },
        set: function (x) { v = pin(x); }
      });
    } catch (e) {}
  });
  if (window.webAbTest) window.webAbTest[KEY] = false;

  // 看门狗：若还看到“精简”态就地纠正成开启
  var S2 = /danmaku-switch-state-2|dm-switch-state-2/;
  function node() { return document.querySelector('.bpx-player-dm-switch, [class*="dm-switch"]'); }
  function concise(el) {
    if (!el) return false;
    var b = el.querySelector('input[type="checkbox"]');
    if (b && (b.indeterminate || b.getAttribute('aria-checked') === 'mixed')) return true;
    var c = el;
    for (var i = 0; i < 3 && c; i++) { if (typeof c.className === 'string' && S2.test(c.className)) return true; c = c.parentElement; }
    return false;
  }
  function fix() {
    var el = node(); if (!el || !concise(el)) return;
    var a = window.player && window.player.danmaku;
    try {
      if (a && a.open) return void a.open();                    // 精简 -> 开启
      var b = el.querySelector('input[type="checkbox"]'); if (b) b.click();
    } catch (e) {}
  }
  document.addEventListener('click', function (ev) {
    var el = node();
    if (!el || !el.contains(ev.target)) return;
    var three = document.querySelector('[class*="danmaku-switch-new"]') ||
      (function () { var b = el.querySelector('input[type="checkbox"]'); return b && (b.indeterminate || b.getAttribute('aria-checked') === 'mixed'); })();
    if (!three) return;                                          // 已是两态，放行官方逻辑
    ev.preventDefault(); ev.stopImmediatePropagation();
    var a = window.player && window.player.danmaku;
    try {
      if (concise(el)) { a && a.open ? a.open() : (el.querySelector('input[type="checkbox"]') || el).click(); return; }
      var open = a && a.isOpen ? !!a.isOpen() : true;
      a ? (open ? a.close() : a.open()) : (el.querySelector('input[type="checkbox"]') || el).click();
    } catch (e) {}
  }, true);
  setInterval(fix, 1000);
  fix();
  console.log('%c[dm-2state] 已启用：弹幕开关 = 开启 / 关闭', 'color:#fb7299;font-weight:bold');
})();
