// ==UserScript==
// @name         Bilibili 弹幕两态化（干掉“精简弹幕”中间态）
// @name:en      Bilibili Danmaku 2-State (remove the Concise middle state)
// @namespace    https://github.com/Transcriptase730/bilibili-danmaku-2state
// @version      1.0.0
// @description  移除 B 站网页端弹幕开关的“精简弹幕”中间态，把弹幕开关恢复成只有「开启 / 关闭」两种状态。点一次就切过去，不再 开启→精简→关闭 三步循环，悬停提示里也不会再出现「精简弹幕 (d)」。
// @author       Transcriptase730
// @license      MIT
// @homepageURL  https://github.com/Transcriptase730/bilibili-danmaku-2state
// @supportURL   https://github.com/Transcriptase730/bilibili-danmaku-2state/issues
// @match        *://www.bilibili.com/*
// @match        *://player.bilibili.com/*
// @match        *://bilibili.com/*
// @run-at       document-start
// @grant        none
// @noframes     false
// ==/UserScript==

/*
 * 逆向依据（来自线上播放器 bundle，可自行核对）：
 *  1) 三态枚举：Unset=0 / Open=1 / Concise=2 / Closed=3
 *  2) 开关是否三态由实验开关决定：
 *     ExpStore.enableDmThreeState
 *       = localeRestrictedExperimentsEnabled(中文环境)
 *         && getExpOrKvBool("dm_three_state_switch", "dm_three_state_switch", false)
 *  3) getAbValue 每次调用都实时读 window.webAbTest["dm_three_state_switch"]
 *     （globalABKey = "webAbTest"），读不到才回落到
 *     localStorage["bilibili_player_kv_config"].dash_config["dm_three_state_switch"]
 *  4) 三态点击循环：nextDmSwitchState() => 1→2, 2→3, 默认→1
 *  5) UI 组件在 threeState=true 时给容器加 class `*-danmaku-switch-new`，
 *     状态 2 会把开关渲染成 indeterminate（aria-checked="mixed"）并加 class `*-danmaku-switch-state-2`
 *  6) 播放器公开 API：window.player.danmaku.open() / .close() / .isOpen()
 *
 * 结论：只要把 window.webAbTest.dm_three_state_switch 钉死成 false，
 *       播放器就会退回原生两态开关；本脚本把这条路径做成“赋值也改不回去”的。
 */

(function () {
  'use strict';

  var CFG = {
    // 万一三态还是活着（脚本被拦、站方换实现），检测到“精简”时强行落到哪个状态：
    //   'open'   = 变成「弹幕开启」（与官方关闭该实验时的默认行为一致，推荐）
    //   'closed' = 变成「弹幕关闭」
    conciseFallback: 'open',

    // 是否顺手把本地 kv 配置里的同名字段也滤掉（第二道保险）
    stripKvConfig: true,

    // 是否接管键盘 hf 'd'（站内快捷键：切换弹幕）以避免它走进三态循环
    guardHotkeyD: true,

    // 控制台调试日志
    debug: false,
  };

  var KEY = 'dm_three_state_switch';
  var TAG = '%c[dm-2state]';
  var CSS = 'color:#fb7299;font-weight:bold';
  function log() {
    if (!CFG.debug) return;
    try { console.log.apply(console, [TAG, CSS].concat([].slice.call(arguments))); } catch (e) {}
  }

  /* ============================================================
   * 第 1 层：把实验开关钉死为 false（核心）
   * ============================================================ */

  function pin(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    try {
      var d = Object.getOwnPropertyDescriptor(obj, KEY);
      if (d && typeof d.get === 'function' && d.get() === false) return obj; // 已经钉过了
      Object.defineProperty(obj, KEY, {
        configurable: true,
        enumerable: true,
        get: function () { return false; },
        set: function () { log('blocked assignment to', KEY); },
      });
      log('pinned', KEY, '-> false');
    } catch (e) {
      // 极端情况下对象被冻结：兜底直接写一次普通值
      try { obj[KEY] = false; } catch (e2) {}
      log('pin failed, fallback plain write', e, e2);
    }
    return obj;
  }

  ['webAbTest', 'abtest'].forEach(function (name) {
    var current = undefined;
    try {
      // 用原始描述符取值，避免走可能已存在的 getter／踩到递归
      var desc = Object.getOwnPropertyDescriptor(window, name);
      if (desc) current = desc.value;
    } catch (e) {}

    if (current) pin(current);

    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: function () { return current; },
        set: function (v) { current = pin(v); log(name, 're-assigned, re-pinned'); },
      });
    } catch (e) {
      log('window accessor install failed for', name, e);
      if (current) pin(current);
    }
  });

  /* ============================================================
   * 第 2 层：滤掉 localStorage 里的回落配置（可选加固）
   * ============================================================ */
  if (CFG.stripKvConfig) {
    try {
      var RAW_KEY = 'bilibili_player_kv_config';
      var rawGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k) {
        var v = rawGetItem.call(this, k);
        if (k === RAW_KEY && typeof v === 'string' && v.indexOf(KEY) !== -1) {
          try {
            var o = JSON.parse(v);
            if (o && o.dash_config && Object.prototype.hasOwnProperty.call(o.dash_config, KEY)) {
              delete o.dash_config[KEY];
              log('local kv config sanitized');
              return JSON.stringify(o);
            }
          } catch (e) {}
        }
        return v;
      };
    } catch (e) {
      log('kv hook failed', e);
    }
  }

  /* ============================================================
   * 第 3 层：运行时看门狗 —— 只要还看见“精简”，就地纠正
   * ============================================================ */

  var STATE2_RE = /danmaku-switch-state-2|dm-switch-state-2/;
  var THREE_RE = /danmaku-switch-new/;
  var SWITCH_SEL = '.bpx-player-dm-switch, [class*="dm-switch"]';

  function findSwitch() {
    try {
      var n = document.querySelector('.bpx-player-dm-switch');
      if (n) return n;
      return document.querySelector(SWITCH_SEL);
    } catch (e) { return null; }
  }

  function dmApi() {
    var p = window.player;
    return p && p.danmaku ? p.danmaku : null;
  }

  // DOM 判定：当前是不是“精简弹幕”态
  function isConcise(node) {
    if (!node || !node.querySelector) return false;
    var box = node.querySelector('input[type="checkbox"]');
    if (box && (box.indeterminate === true || box.getAttribute('aria-checked') === 'mixed')) return true;
    var cur = node;
    for (var i = 0; i < 3 && cur; i++) {
      if (typeof cur.className === 'string' && STATE2_RE.test(cur.className)) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  // DOM 判定：三态 UI 是否还在生效（容器带 `*-danmaku-switch-new`）
  function isThreeStateUI() {
    try {
      if (document.querySelector('[class*="danmaku-switch-new"]')) return true;
      var n = findSwitch();
      var box = n && n.querySelector('input[type="checkbox"]');
      return !!(box && (box.indeterminate === true || box.getAttribute('aria-checked') === 'mixed'));
    } catch (e) { return false; }
  }

  function forceTwoState(reason) {
    var node = findSwitch();
    if (!node || !isConcise(node)) return;
    log('concise state detected ->', CFG.conciseFallback, '(' + reason + ')');

    var api = dmApi();
    try {
      if (api) {
        if (CFG.conciseFallback === 'open' && api.open) { api.open(); return; }
        if (api.close) { api.close(); return; }
        if (api.open) { api.open(); return; }
      }
    } catch (e) { log('api call failed', e); }

    // 退化路径：直接点开关（三态循环下 2 -> 3）
    var box = node.querySelector('input[type="checkbox"]');
    try {
      if (box) box.click();
      else node.click();
    } catch (e) { log('dom fallback failed', e); }
  }

  // 点击接管：三态还活着时，开启 -> 关闭 一步到位，跳过中间态
  function onClickCapture(ev) {
    if (!isThreeStateUI()) return;                 // 正常情况下实验已被钉死，这里直接放过
    var node = findSwitch();
    if (!node || !node.contains(ev.target)) return;

    ev.preventDefault();
    ev.stopImmediatePropagation();

    var api = dmApi();
    var open = true;
    try {
      if (isConcise(node)) {                       // 当前是精简 -> 按回落设置走
        if (api) { CFG.conciseFallback === 'closed' ? api.close() : api.open(); }
        else { var b = node.querySelector('input[type="checkbox"]'); b && b.click(); }
        return;
      }
      open = api && api.isOpen ? !!api.isOpen() : true;
      if (api) { open ? api.close() : api.open(); }
      else { var b2 = node.querySelector('input[type="checkbox"]'); b2 && b2.click(); }
    } catch (e) { log('click takeover failed', e); }
  }

  // 快捷键 hf 'd' 接管：别让它走三态循环
  function onKeyDownCapture(ev) {
    if (!CFG.guardHotkeyD) return;
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    if (ev.key !== 'd' && ev.key !== 'D') return;

    var t = ev.target;
    if (t && (t.isContentEditable ||
              /^(input|textarea|select)$/i.test(t.tagName || '') ||
              (t.closest && t.closest('[contenteditable="true"], .bpx-player-dm-input, .reply-box, .comment-container')))) {
      return;
    }
    if (!document.querySelector('.bpx-player-container')) return;
    if (!isThreeStateUI()) return;                 // 已是两态，交给官方逻辑

    ev.preventDefault();
    ev.stopImmediatePropagation();

    var api = dmApi();
    try {
      var open = api && api.isOpen ? !!api.isOpen() : true;
      if (api) { open ? api.close() : api.open(); }
      else { var b = findSwitch(); b && b.click(); }
    } catch (e) { log('hotkey takeover failed', e); }
  }

  var lastRun = 0;
  function throttledCheck() {
    var now = Date.now();
    if (now - lastRun < 120) return;
    lastRun = now;
    forceTwoState('mutation');
  }

  function start() {
    try { document.addEventListener('click', onClickCapture, true); } catch (e) {}
    try { document.addEventListener('keydown', onKeyDownCapture, true); } catch (e) {}

    // 节点一出现就挂属性观察，避免全文档 attributes 观察带来的开销
    var attached = null;
    function attachNodeObserver() {
      var node = findSwitch();
      if (!node || node === attached) return;
      attached = node;
      try {
        new MutationObserver(throttledCheck).observe(node, {
          attributes: true,
          attributeFilter: ['class', 'aria-checked', 'indeterminate'],
          subtree: true,
          childList: true,
        });
      } catch (e) {}
    }

    try {
      new MutationObserver(function () {
        attachNodeObserver();
        throttledCheck();
      }).observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}

    attachNodeObserver();
    forceTwoState('init');

    // 兜底轮询：站点换实现 / 脚本被拦时也能纠正
    setInterval(function () {
      attachNodeObserver();
      forceTwoState('interval');
    }, 1000);

    // 切集、换 P、播放器重建后也检查一次
    try {
      window.addEventListener('message', throttledCheck, false);
      document.addEventListener('visibilitychange', throttledCheck, false);
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  log('loaded. pin =', window.webAbTest && window.webAbTest[KEY]);
})();
