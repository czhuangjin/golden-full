/* ============================================================
 * 黄金定制 完整版 — 演示内核 (golden-kernel.js)
 *
 * 职责：本地"看着玩"模式实现数据契约（docs/data-contract.md）
 *   1. 配置持久化：所有"已保存"的操作写入 localStorage，刷新不丢
 *   2. 系统操作模拟：重启 / 关机 / 恢复出厂 / 固件升级 / 参数备份恢复
 *   3. __goldenBridge 契约接口（get/set/run），真实固件由 golden-bridge.js 覆盖
 * ============================================================ */
(function () {
  'use strict';

  var LS_KEY = 'golden-full-v2';
  var bridge = window.__goldenBridge || (window.__goldenBridge = {});
  var mock = bridge.mockRef || {};

  /* ================= 1. 配置持久化 ================= */
  var WHITELIST = [
    'wanConfigs', 'lanConfig', 'qos', 'loadBalance', 'bandwidthAgg', 'ddns',
    'arpBind', 'arpDefense', 'ipLimit', 'accessRules', 'appLimit',
    'appLimitRules', 'domainRedirect', 'domainFilter', 'domainFilterMode', 'domainFilterRules',
    'connSettings', 'connLimit', 'ddos',
    'dhcpDetect', 'dhcpDetectLogs', 'dhcp', 'policyRoutes', 'policyLogs', 'macSettings',
    'staticRoutes', 'portMaps', 'portTriggers', 'portTriggerRules', 'dmz', 'upnp', 'mirrorPort',
    'ipLibraries', 'arpLogs',
    'wanHarden', 'dnsBlockLogs', 'loginBanList',
    'secEvents', 'banList', 'dnsAuditLogs', 'dnsAuditEnabled',
    'systemName', 'access', 'admin', 'routeLogs', 'pppoeLogs', 'accessLogs', 'ddosLogs', 'attackLogs',
    'speedLimitRules', 'bandwidthGuaranteeRules', 'connLimitRules', 'defaultConnLimit', 'ddosSettings', 'ddosRules'
  ];

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
  }

  function hydrate() {
    var saved = loadSaved();
    Object.keys(saved).forEach(function (k) {
      if (WHITELIST.indexOf(k) >= 0 && saved[k] !== undefined && saved[k] !== null) {
        try { mock[k] = saved[k]; } catch (e) {}
      }
    });
  }

  function persist() {
    /* 真实模式：交给 golden-bridge 推送 UCI；演示模式：写 localStorage */
    if (bridge.save) { try { bridge.save(); return; } catch (e) {} }
    try {
      var out = {};
      WHITELIST.forEach(function (k) { out[k] = mock[k]; });
      localStorage.setItem(LS_KEY, JSON.stringify(out));
    } catch (e) {}
  }

  /* ================= 2. 保存自动持久化（包装 showToast） ================= */
  var _origToast = window.showToast;
  window.showToast = function (msg) {
    if (msg && (msg.indexOf('已保存') >= 0 || msg.indexOf('已修改') >= 0 ||
        msg.indexOf('已删除') >= 0 || msg.indexOf('已添加') >= 0 ||
        msg.indexOf('已应用') >= 0 || msg.indexOf('已更新') >= 0 ||
        msg.indexOf('已开启') >= 0 || msg.indexOf('已关闭') >= 0 ||
        msg.indexOf('已启用') >= 0 || msg.indexOf('已禁用') >= 0)) {
      setTimeout(persist, 60);
    }
    if (_origToast) return _origToast(msg);
  };

  /* ================= 3. __goldenBridge 契约实现 ================= */
  var DOMAIN_MAP = {
    'network.wan': 'wanConfigs',
    'network.lan': 'lanConfig',
    'dhcp': 'dhcp',
    'qos': 'qos',
    'lb': 'loadBalance',
    'agg': 'bandwidthAgg',
    'ddns': 'ddns',
    'arp': 'arpBind',
    'behavior': 'accessRules',
    'policy': 'policyRoutes',
    'advanced': 'access',
    'admin': 'admin'
  };

  bridge.mode = 'demo';
  bridge.get = function (action, params) {
    var d = null;
    switch (action) {
      case 'sysinfo':
        d = { cpu: mock.cpu, memory: mock.memory, runTime: mock.runTime,
              conns: mock.currentConn, connCapacity: mock.connCapacity };
        break;
      case 'waninfo': d = mock.wanConfigs || []; break;
      case 'laninfo': d = mock.lanConfig || null; break;
      case 'hosts': d = mock.hosts || []; break;
      case 'arp': d = mock.arpBind || []; break;
      case 'traffic': d = mock.trafficLinks || []; break;
      case 'logs': d = mock.logs || []; break;
      case 'config': d = mock; break;
      case 'secevents': d = { events: mock.secEvents || [] }; break;
      case 'banlist': d = { banned: mock.banList || [] }; break;
      case 'dnsaudit': d = { enabled: !!mock.dnsAuditEnabled }; break;
      case 'dnsauditlogs': d = { logs: mock.dnsAuditLogs || [] }; break;
      default: d = mock[action] || null;
    }
    return { ok: true, data: d };
  };

  bridge.set = function (domain, config) {
    try {
      var key = DOMAIN_MAP[domain];
      if (key && mock) { mock[key] = config; } else { mock[domain] = config; }
      persist();
      return { ok: true };
    } catch (e) { return { ok: false, msg: String(e) }; }
  };

  bridge.run = function (action, params) {
    switch (action) {
      case 'ping':
        return { ok: true, data: { addr: params && params.host, time: 12 + Math.floor(Math.random() * 30), ttl: 55 + Math.floor(Math.random() * 10) } };
      case 'reboot': sysReboot(); return { ok: true };
      case 'poweroff': sysPoweroff(); return { ok: true };
      case 'reset': sysReset(); return { ok: true };
      case 'upgrade': sysUpgrade(); return { ok: true };
      case 'saveapply': persist(); return { ok: true };
      case 'restartservice':
        if (window.showToast) showToast('服务已重启：' + (params && params.service ? params.service : ''));
        return { ok: true };
      case 'ctcnc-default':
      case 'ctcnc-download':
        return { ok: true, imported: 3000 + Math.floor(Math.random() * 2000), key: params && params.key };
      case 'ctcnc-import':
        return { ok: true, imported: 3000 + Math.floor(Math.random() * 2000), key: params && params.key };
      case 'arplog-clear':
        if (mock.arpLogs) mock.arpLogs = [];
        return { ok: true };
      case 'login-banlist':
        return { ok: true, banned: [] };
      case 'login-unban':
        if (window.showToast) showToast('已解除封禁：' + (params && params.ip ? params.ip : ''));
        return { ok: true };
      case 'block-ip': {
        const v = params && params.ip;
        if (!v) return { ok: false, msg: '缺少 IP' };
        mock.banList = mock.banList || [];
        if (mock.banList.indexOf(v) < 0) mock.banList.push(v);
        if (window.showToast) showToast('已封禁 IP：' + v);
        return { ok: true };
      }
      case 'unblock-ip': {
        const v = params && params.ip;
        if (v) mock.banList = (mock.banList || []).filter(x => x !== v);
        if (window.showToast) showToast('已解封 IP：' + (v || ''));
        return { ok: true };
      }
      case 'dnsaudit-clear':
        mock.dnsAuditLogs = [];
        return { ok: true };
      default: return { ok: false, msg: '未知操作: ' + action };
    }
  };

  /* ================= 4. 系统操作模拟 ================= */
  function overlay(msg, sub) {
    var o = document.createElement('div');
    o.id = 'kernelOverlay';
    o.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(2,6,23,.86);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:inherit;';
    o.innerHTML = '<div style="font-size:20px;margin-bottom:8px;">' + msg + '</div>' +
      (sub ? '<div id="kernelSub" style="font-size:14px;color:#94a3b8;">' + sub + '</div>' : '');
    document.body.appendChild(o);
    return o;
  }

  function removeOverlay() {
    var o = document.getElementById('kernelOverlay');
    if (o) o.remove();
  }

  window.sysReboot = function () {
    if (!confirm('确定要重启路由器吗？')) return;
    var o = overlay('正在重启路由器...', '网络连接将暂时中断，请稍候（演示：3 秒后恢复）');
    var n = 3;
    var t = setInterval(function () {
      n--;
      var s = document.getElementById('kernelSub');
      if (s) s.textContent = '演示：' + n + ' 秒后恢复';
      if (n <= 0) {
        clearInterval(t);
        removeOverlay();
        showToast('路由器重启完成，运行时间已重置');
        mock.runTime = '0时0分5秒';
        mock.currentConn = '0';
        setTimeout(function () { mock.currentConn = String(Math.floor(Math.random() * 500) + 300); }, 2000);
      }
    }, 1000);
  };

  window.sysPoweroff = function () {
    if (!confirm('确定要关闭路由器吗？')) return;
    var o = overlay('系统已关机', '演示模式：点击屏幕任意位置恢复');
    o.addEventListener('click', function () { removeOverlay(); showToast('系统已重新启动'); });
  };

  window.sysReset = function () {
    if (!confirm('确定要恢复默认设置吗？\n当前所有配置将被清除（演示数据也会重置）。')) return;
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    overlay('正在恢复出厂设置...', '即将重新载入系统');
    setTimeout(function () { location.reload(); }, 1500);
  };

  window.sysUpgrade = function () {
    var f = document.getElementById('firmwareFile');
    if (!f || !f.files || !f.files.length) { showToast('请先选择固件文件'); return; }
    var name = f.files[0].name;
    if (!confirm('确定要升级固件吗？\n文件：' + name)) return;
    var o = overlay('正在上传并升级固件...', '0%');
    var p = 0;
    var t = setInterval(function () {
      p = Math.min(100, p + Math.floor(Math.random() * 14) + 4);
      var s = document.getElementById('kernelSub');
      if (s) s.textContent = p + '%  正在写入闪存...';
      if (p >= 100) {
        clearInterval(t);
        s.textContent = '升级成功，系统正在重启...';
        setTimeout(function () {
          removeOverlay();
          showToast('固件升级成功，已重启（演示）');
        }, 1800);
      }
    }, 300);
  };

  window.sysBackup = function () {
    var out = {};
    WHITELIST.forEach(function (k) { out[k] = mock[k]; });
    out._meta = { brand: '黄金定制', version: 'H-2.01.779', exportTime: new Date().toLocaleString() };
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'golden-config.json';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('系统参数已保存为 golden-config.json');
  };

  window.sysRestore = function () {
    var f = document.getElementById('restoreFile');
    if (!f || !f.files || !f.files.length) { showToast('请先选择备份文件'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var cfg = JSON.parse(reader.result);
        Object.keys(cfg).forEach(function (k) {
          if (WHITELIST.indexOf(k) >= 0) { try { mock[k] = cfg[k]; } catch (e) {} }
        });
        persist();
        showToast('系统参数已恢复，页面刷新中...');
        setTimeout(function () { location.reload(); }, 800);
      } catch (e) { showToast('备份文件格式错误，恢复失败'); }
    };
    reader.readAsText(f.files[0]);
  };

  /* ================= 5. 演示模式状态条 ================= */
  function injectStatusBar() {
    var bar = document.querySelector('.topbar-right');
    if (!bar) return;
    var badge = document.createElement('span');
    badge.style.cssText = 'background:#f59e0b;color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;margin-right:10px;cursor:pointer;';
    badge.textContent = '演示模式';
    badge.title = '未检测到路由器后端，当前为本地演示数据。写入固件后自动切换为真实模式。';
    bar.insertBefore(badge, bar.firstChild);
  }

  /* ================= 6. 轻量实时数据 tick ================= */
  function startTick() {
    setInterval(function () {
      try {
        mock.currentConn = String(Math.max(0, parseInt(mock.currentConn || '0') + Math.floor(Math.random() * 41) - 20));
        mock.cpu = (Math.random() * 40 + 5).toFixed(2);
        if (mock.memory) {
          var f = parseFloat(mock.memory.free || '0');
          mock.memory.free = (f + Math.random() * 0.02 - 0.01).toFixed(2);
        }
      } catch (e) {}
    }, 3000);
  }

  /* ================= 7. 启动 ================= */
  hydrate();
  setTimeout(injectStatusBar, 300);
  startTick();
  window.addEventListener('beforeunload', persist);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') persist();
  });
})();
