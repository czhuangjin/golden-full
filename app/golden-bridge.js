/* ============================================================
 * 黄金定制 完整版 — 真实模式桥接层 (golden-bridge.js)
 * 加载顺序：golden-kernel.js（演示内核）之后加载。
 * 探测到 /cgi-bin/golden-api 后接管 __goldenBridge：
 *   get / set / run / save 全部走真实后端，配置真实写入 UCI。
 * 真实模式带会话认证：token 附带所有请求，401 触发登录、403 提示只读。
 * 探测失败则静默保持演示模式，不白屏。
 * ============================================================ */
(function () {
  'use strict';
  var API = '/cgi-bin/golden-api';
  var TOKEN_KEY = 'golden_session_token';
  var bridge = window.__goldenBridge;
  if (!bridge || !bridge.mockRef) return;
  var mock = bridge.mockRef;

  /* ---------- 会话 token ---------- */
  bridge.api = API;
  bridge.token = '';
  try { bridge.token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  bridge.saveToken = function (t) {
    bridge.token = t || '';
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  };

  /* ---------- 线路名称 ↔ 接口 id ----------
   * 后端 getWaninfo 按 uci show network 的 wan* 顺序枚举：首个 wan 段即「广域网1」，
   * 其 id 通常是 wan（默认命名）也可能是 wan1。回填时把真实 id 存在 _ucId，
   * wanId() 优先用它，保证两种命名都能正确写回。 */
  var WAN_NAME_MAP = { '广域网1': 'wan', '广域网2': 'wan2', '广域网3': 'wan3', '广域网4': 'wan4', 'vpn1': 'vpn1', 'vpn2': 'vpn2' };
  function wanId(name) {
    var cfg = (mock.wanConfigs || []).filter(function (w) { return w.name === name; })[0];
    if (cfg && cfg._ucId) return cfg._ucId;
    return WAN_NAME_MAP[name] || name || 'wan';
  }
  /* DDNS 前端 wanIdx → UCI 接口 id（后端 getDdns：wan→0, wan2→1, wan3→2 …） */
  function wanUcIdFromIdx(idx) {
    var n = parseInt(idx, 10);
    if (isNaN(n)) n = 0;
    var cfg = (mock.wanConfigs || [])[n];
    if (cfg && cfg._ucId) return cfg._ucId;
    return n <= 0 ? 'wan' : 'wan' + (n + 1);
  }

  function fetchJSON(url, opts) {
    return fetch(url, opts).then(function (r) { return r.json(); }).catch(function () { return { ok: false }; });
  }

  /* ---------- 认证请求头：token 一律走 X-Golden-Token（不进 URL，防日志/Referer 泄露） ---------- */
  function authHeaders() {
    var h = {};
    if (bridge.token) h['X-Golden-Token'] = bridge.token;
    return h;
  }

  /* ---------- 统一响应处理：401 → 要求登录；403 → 只读提示 ---------- */
  function handleResp(j) {
    if (j && j.ok) return j.payload || {};
    if (j && j.code === 401) { if (bridge.onAuthRequired) bridge.onAuthRequired(); return null; }
    if (j && j.code === 403) { if (bridge.onForbidden) bridge.onForbidden(j.error || '访客账号为只读权限'); return null; }
    return null;
  }

  /* ---------- 拉取真实数据并覆盖 mock（需已登录） ---------- */
  function adoptRealData() {
    return fetchJSON(API + '?action=get&name=all', { headers: authHeaders() }).then(function (j) {
      if (!j || !j.ok || !j.payload) return;
      var p = j.payload;
      if (p.sysinfo) {
        mock.runTime = p.sysinfo.runTime || mock.runTime;
        mock.currentConn = String(p.sysinfo.currentConn != null ? p.sysinfo.currentConn : mock.currentConn);
        mock.connCapacity = p.sysinfo.connCapacity || mock.connCapacity;
        mock.cpuModel = p.sysinfo.cpuModel || mock.cpuModel;
        mock.memory = { total: p.sysinfo.memTotalG || mock.memory.total, free: p.sysinfo.memFreeG || mock.memory.free };
      }
      if (p.waninfo && p.waninfo.length) {
        mock.wanCount = p.waninfo.length;
        p.waninfo.forEach(function (w, i) {
          var t = mock.wanConfigs[i];
          if (t) {
            t.name = (w.id === 'wan' && p.waninfo.length === 1) ? '广域网1' : ('广域网' + (i + 1));
            t._ucId = w.id;
            t.connType = ({ dhcp: 'DHCP', static: 'Static', pppoe: 'PPPoE', pptp: 'PPTP', l2tp: 'L2TP' })[w.proto] || w.proto || 'DHCP';
            t.ip = w.ip || t.ip;
            t.mask = w.mask || t.mask;
            t.gateway = w.gateway || t.gateway;
            t.mac = w.mac || t.mac;
            t.mtu = w.mtu ? parseInt(w.mtu, 10) : t.mtu;
            t.dns1 = w.dns1 || t.dns1;
            t.dns2 = w.dns2 || t.dns2;
            t.status = w.status || t.status;
          } else {
            mock.wanConfigs.push({ name: '广域网' + (i + 1), _ucId: w.id, connType: w.proto || 'DHCP', ip: w.ip, mask: w.mask, gateway: w.gateway, mac: w.mac, mtu: w.mtu ? parseInt(w.mtu, 10) : 1500, dns1: w.dns1, dns2: w.dns2, status: w.status });
          }
        });
        /* 裁剪演示模式多余的线路，避免误把 demo 的「广域网N」当真实接口推给后端 */
        if (mock.wanConfigs.length > p.waninfo.length) mock.wanConfigs.length = p.waninfo.length;
      }
      if (p.laninfo) {
        mock.lanIp = p.laninfo.ip || mock.lanIp;
        mock.lanMask = p.laninfo.mask || mock.lanMask;
        mock.lanMac = p.laninfo.mac || mock.lanMac;
      }
      if (p.hosts && p.hosts.length) {
        mock.hosts = p.hosts.map(function (h) {
          return { user: h.name || '(未命名)', ip: h.ip, mac: h.mac, client: h.client || '', status: h.status || '在线', conn: 0, up: '0 b', down: '0 b' };
        });
      }
      if (p.arp) {
        if (p.arp.list) mock.arpList = p.arp.list;
        if (p.arp.bindings) mock.arpBind = p.arp.bindings;
      }
      if (p.logs) mock.logs = p.logs;
      if (p.conns) mock.connStats = p.conns;
      if (p.loginusers) mock.loginUsers = p.loginusers;
      if (p.domainresolve) mock.domainResolve = p.domainresolve;
      /* 真实流量：/proc/net/dev 累计字节/包 → trafficLinks，协议占比用 conntrack 分布近似 */
      if (p.traffic && p.traffic.length) {
        var devMap = {};
        p.traffic.forEach(function (d) { devMap[d.name] = d; });
        var wanIds = (p.waninfo || []).map(function (w) { return w.id; });
        if (!wanIds.length) wanIds = ['wan'];
        mock._wanDevIds = wanIds;
        var wanNames = wanIds.map(function (id, i) { return (id === 'wan' && wanIds.length === 1) ? '广域网1' : '广域网' + (i + 1); });
        var ttl = p.conns && p.conns.total ? p.conns.total : 0;
        var split = null;
        if (ttl > 0) {
          var tc = p.conns.tcp || 0, uc = p.conns.udp || 0, ic = p.conns.icmp || 0;
          split = { tcp: tc / ttl, udp: uc / ttl, icmp: ic / ttl, other: Math.max(0, 1 - (tc + uc + ic) / ttl) };
        }
        var mkRows = function (ids) {
          var rxB = 0, txB = 0, rxp = 0, txp = 0;
          ids.forEach(function (id) { var d = devMap[id]; if (d) { rxB += d.rxBytes || 0; txB += d.txBytes || 0; rxp += d.rxPackets || 0; txp += d.txPackets || 0; } });
          var mk = function (ratio) {
            ratio = ratio || 0;
            return {
              upData: (txB * ratio / 1048576).toFixed(1) + ' M',
              upReqSpeed: '0.0 K', upPackets: Math.round(txp * ratio),
              upAllocSpeed: '0.0 K', upAllocPackets: Math.round(txp * ratio),
              downData: (rxB * ratio / 1048576).toFixed(1) + ' M',
              downReqSpeed: '0.0 K', downPackets: Math.round(rxp * ratio),
              downAllocSpeed: '0.0 K', downAllocPackets: Math.round(rxp * ratio)
            };
          };
          if (!split) return { tcp: mk(1), udp: mk(1), icmp: mk(1), other: mk(1) };
          return { tcp: mk(split.tcp), udp: mk(split.udp), icmp: mk(split.icmp), other: mk(split.other) };
        };
        mock.trafficLinks = [{ name: '全部广域网', rows: mkRows(wanIds) }].concat(wanNames.map(function (nm, i) { return { name: nm, rows: mkRows([wanIds[i]]) }; }));
      }
      if (p.access) {
        mock.access.httpPort = p.access.httpPort || mock.access.httpPort;
        mock.access.remoteAccess = !!p.access.remoteAccess;
        mock.access.remotePort = p.access.remotePort || mock.access.remotePort;
        mock.access.remoteAllow = p.access.remoteAllow || '';
        mock.access.adminUser = p.access.adminUser || mock.access.adminUser;
        mock.access.guestUser = p.access.guestUser || mock.access.guestUser;
        mock.access.loginLock = p.access.loginLock || mock.access.loginLock;
        mock.access.sessionTimeout = p.access.sessionTimeout || mock.access.sessionTimeout;
        if (p.access.ssh) {
          mock.access.ssh.enabled = !!p.access.ssh.enabled;
          mock.access.ssh.localPort = p.access.ssh.localPort || mock.access.ssh.localPort;
          mock.access.ssh.remoteAccess = !!p.access.ssh.remoteAccess;
          mock.access.ssh.remotePort = p.access.ssh.remotePort || mock.access.ssh.remotePort;
          mock.access.ssh.passwordAuth = p.access.ssh.passwordAuth !== false;
          mock.access.ssh.authKey = p.access.ssh.authKey || '';
        }
      }
      if (p.admin) {
        mock.admin.oldUser = p.admin.username || mock.admin.oldUser;
        mock.admin.newUser = p.admin.username || mock.admin.newUser;
      }
      if (p.dhcp) {
        mock.dhcp = {
          enabled: !!p.dhcp.enabled,
          start: p.dhcp.start || mock.dhcp.start,
          end: p.dhcp['end'] || p.dhcp.endIp || mock.dhcp.end,
          gateway: p.dhcp.gateway || mock.dhcp.gateway,
          dns1: p.dhcp.dns1 || '',
          dns2: p.dhcp.dns2 || '',
          lease: p.dhcp.lease || mock.dhcp.lease
        };
      }
      /* ===== 批3：域名过滤 / 应用限制 / 电信网通 / 端口触发 / 镜像 / ARP 防御 ===== */
      if (p.domainfilter) {
        mock.domainFilterMode = p.domainfilter.mode || 'disable';
        if (p.domainfilter.rules) mock.domainFilterRules = p.domainfilter.rules;
        /* 批4：拦截审计 + DNS 防投毒 */
        if (p.domainfilter.audit !== undefined) mock.domainFilterAudit = !!p.domainfilter.audit;
        if (p.domainfilter.rebindProtect !== undefined) mock.domainFilterRebindProtect = !!p.domainfilter.rebindProtect;
      }
      if (p.applimit) {
        if (p.applimit.rules) mock.appLimitRules = p.applimit.rules;
        if (p.applimit.templates) mock.appTypes = Object.keys(p.applimit.templates);
      }
      if (p.ctcnc && p.ctcnc.libraries) {
        mock.ipLibraries = p.ctcnc.libraries.map(function (l) {
          return { key: l.key, name: l.name, enabled: !!l.enabled, count: l.count || 0, file: l.file || '' };
        });
      }
      if (p.porttrigger && p.porttrigger.rules) {
        mock.portTriggerRules = p.porttrigger.rules;
      }
      if (p.mirror) {
        mock.mirrorPort = {
          enabled: !!p.mirror.enabled,
          dir: p.mirror.dir || 'all',
          mode: p.mirror.mode || 'host',
          ip: p.mirror.ip || ''
        };
      }
      if (p.arpdefense) {
        mock.arpDefense = {
          fakeGatewayEnabled: !!p.arpdefense.fakeGatewayEnabled,
          fakeGatewayInterval: p.arpdefense.fakeGatewayInterval || 200,
          illegalGatewayEnabled: !!p.arpdefense.illegalGatewayEnabled,
          illegalGatewayInterval: p.arpdefense.illegalGatewayInterval || 10,
          analysisLevel: p.arpdefense.analysisLevel || '中'
        };
      }
      if (p.arplogs) mock.arpLogs = p.arplogs;
      /* ===== 批4：安全加固 / 域名拦截审计 / UPnP 安全模式 ===== */
      if (p.wanharden) {
        mock.wanHarden = {
          pingWan: !!p.wanharden.pingWan,
          ttlDrop: !!p.wanharden.ttlDrop,
          scanEnable: !!p.wanharden.scanEnable,
          scanHitcount: p.wanharden.scanHitcount || mock.wanHarden.scanHitcount,
          scanSeconds: p.wanharden.scanSeconds || mock.wanHarden.scanSeconds
        };
      }
      if (p.dnsblocklogs) mock.dnsBlockLogs = p.dnsblocklogs;
      if (p.upnp) {
        mock.upnp = { enabled: !!p.upnp.enabled, secure: !!p.upnp.secure };
      }
      /* ===== 批5：安全事件中心 / 封禁列表 / 上网行为审计 ===== */
      if (p.secevents) mock.secEvents = p.secevents.events || p.secevents;
      if (p.banlist) mock.banList = (p.banlist.banned) || [];
      if (p.dnsaudit) mock.dnsAuditEnabled = !!p.dnsaudit.enabled;
      if (p.dnsauditlogs) mock.dnsAuditLogs = p.dnsauditlogs.logs || p.dnsauditlogs;
      /* ===== 批8：真实数据全量回填（登录后一次拉全，各页进入即真实数据） ===== */
      if (p.qos) {
        mock.qos.enabled = !!p.qos.enabled;
        mock.qos.mode = p.qos.mode || mock.qos.mode;
        if (p.qos.wans && p.qos.wans.length) mock.qos.wans = p.qos.wans;
        if (p.qos.exceptions) mock.qos.exceptions = p.qos.exceptions;
      }
      if (p.loadbalance && p.loadbalance.lines) {
        mock.loadBalance.mode = p.loadbalance.mode || mock.loadBalance.mode;
        mock.loadBalance.lines = p.loadbalance.lines.map(function (l) {
          var old = {};
          (mock.loadBalance.lines || []).forEach(function (x) { if (x.wan === l.wan) old = x; });
          var m = {};
          Object.keys(old).forEach(function (k) { m[k] = old[k]; });
          Object.keys(l).forEach(function (k) { m[k] = l[k]; });
          return m;
        });
      }
      if (p.bandwidthagg) {
        mock.bandwidthAgg.enabled = !!p.bandwidthagg.enabled;
        mock.bandwidthAgg.mode = p.bandwidthagg.mode || mock.bandwidthAgg.mode;
        if (p.bandwidthagg.lines) {
          mock.bandwidthAgg.lines = p.bandwidthagg.lines.map(function (l) {
            var old = {};
            (mock.bandwidthAgg.lines || []).forEach(function (x) { if (x.wan === l.wan) old = x; });
            var m = {};
            Object.keys(old).forEach(function (k) { m[k] = old[k]; });
            Object.keys(l).forEach(function (k) { m[k] = l[k]; });
            return m;
          });
        }
      }
      if (p.ddns) {
        if (p.ddns.records) mock.ddns.records = p.ddns.records;
        mock.ddns.selectedIndex = -1;
        if (p.ddns.current) mock.ddns.current = p.ddns.current;
      }
      if (p.speedlimit) mock.speedLimitRules = p.speedlimit.rules || p.speedlimit;
      if (p.bandwidthguarantee && p.bandwidthguarantee.rules) mock.bandwidthGuaranteeRules = p.bandwidthguarantee.rules;
      if (p.connlimit) {
        mock.defaultConnLimit = p.connlimit.defaultConnLimit || 0;
        if (p.connlimit.rules) mock.connLimitRules = p.connlimit.rules;
      }
      if (p.ddos) {
        if (p.ddos.settings) mock.ddosSettings = p.ddos.settings;
        if (p.ddos.rules) mock.ddosRules = p.ddos.rules;
      }
      if (p.dhcpdetect) {
        mock.dhcpDetect = {
          interval: p.dhcpdetect.interval || mock.dhcpDetect.interval,
          intercept: !!p.dhcpdetect.intercept,
          alert: p.dhcpdetect.alert || mock.dhcpDetect.alert
        };
      }
      if (p.dhcpdetectlogs) mock.dhcpDetectLogs = p.dhcpdetectlogs;
      if (p.lbstatus && p.lbstatus.length) mock.lineStatus = p.lbstatus;
      if (p.policyroutes) mock.policyRoutes = p.policyroutes;
      if (p.firewall) {
        if (p.firewall.connMax) mock.connSettings.maxConn = p.firewall.connMax;
        if (p.firewall.portmaps) {
          mock.portMapRules = p.firewall.portmaps.map(function (m, i) {
            return { id: i + 1, active: true, desc: '端口映射', protocol: 'TCP', srcLimit: '', extPort: m.extPort, intPort: m.intPort || m.extPort, intIp: m.intIp, wan: 'ALL' };
          });
        }
        if (p.firewall.upnp) {
          mock.upnp.enabled = !!p.firewall.upnp.enabled;
          mock.upnp.secure = !!p.firewall.upnp.secure;
        }
      }
      if (p.behavior) {
        mock.ipLimit.enabled = !!p.behavior.enable;
        if (p.behavior.ipLimit) {
          mock.ipLimit.rules = p.behavior.ipLimit.map(function (r, i) {
            var seg = String(r.ip || '').split('-');
            return { id: i + 1, start: seg[0] || '', end: (seg[1] || seg[0]) || '', desc: '' };
          });
        }
      }
      if (p.accessrules) {
        mock.accessMode = p.accessrules.mode || 'disabled';
        if (p.accessrules.rules) mock.accessRules = p.accessrules.rules;
      }
      if (p.systemname && p.systemname.name) mock.sysName = p.systemname.name;
      if (p.systemtime) mock.sysTime = p.systemtime.time;
      if (p.staticroutes) mock.staticRoutes = p.staticroutes;
      if (p.domainredirect && p.domainredirect.rules) mock.domainRedirectRules = p.domainredirect.rules;
      if (p.macsettings) mock.macSettings = p.macsettings;
      if (p.loginbanlist) mock.loginBanList = p.loginbanlist.banned || [];
    }).catch(function () {});
  }

  /* ---------- 认证接口 ---------- */
  bridge.login = function (user, pass) {
    return fetchJSON(API + '?action=auth&name=login', { method: 'POST', body: JSON.stringify({ user: user, pass: pass }) })
      .then(function (j) {
        if (j && j.ok && j.payload && j.payload.token) {
          bridge.saveToken(j.payload.token);
          adoptRealData();
          return { ok: true, role: j.payload.role, user: j.payload.user, firstLogin: !!j.payload.firstLogin };
        }
        return { ok: false, error: (j && j.error) || '登录失败' };
      });
  };
  bridge.logout = function () {
    var t = bridge.token;
    bridge.saveToken('');
    if (t) fetchJSON(API + '?action=auth&name=logout', { method: 'POST', headers: authHeaders() });
  };

  /* ---------- 流量轮询：真实速率（两次采样差值） ---------- */
  var TRAFFIC_PREV = null;
  bridge.pollTraffic = function () {
    var sel = document.getElementById('trafficLinkSel');
    var idx = sel ? parseInt(sel.value, 10) : 0;
    if (isNaN(idx)) idx = 0;
    return fetchJSON(API + '?action=get&name=traffic', { headers: authHeaders() }).then(function (j) {
      var list = (j && j.ok && j.payload) || [];
      if (!list.length) return null;
      var now = Date.now();
      var prev = TRAFFIC_PREV;
      var dt = prev ? (now - prev.t) / 1000 : 0;
      TRAFFIC_PREV = { t: now, devs: list };
      if (!dt || dt <= 0) return { up: 0, down: 0 };
      var ids = mock._wanDevIds || ['wan'];
      var want = (idx > 0 && idx <= ids.length) ? [ids[idx - 1]] : ids;
      var up = 0, down = 0;
      want.forEach(function (id) {
        var cur = null, old = null;
        for (var i = 0; i < list.length; i++) if (list[i].name === id) cur = list[i];
        for (var k = 0; k < prev.devs.length; k++) if (prev.devs[k].name === id) old = prev.devs[k];
        if (cur && old) {
          up += Math.max(0, (cur.txBytes - old.txBytes) / dt) / 1024;
          down += Math.max(0, (cur.rxBytes - old.rxBytes) / dt) / 1024;
        }
      });
      return { up: up, down: down };
    });
  };

  /* ---------- 真实模式三接口（token 走请求头；危险操作全 POST） ---------- */
  function activateReal() {
    bridge.mode = 'real';
    bridge.get = function (action, params) {
      var q = '?action=get&name=' + encodeURIComponent(action);
      if (params) Object.keys(params).forEach(function (k) { q += '&' + k + '=' + encodeURIComponent(params[k]); });
      return fetchJSON(API + q, { headers: authHeaders() }).then(function (j) { return handleResp(j); });
    };
    bridge.set = function (domain, config) {
      return fetchJSON(API + '?action=set', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ domain: domain, config: config }) })
        .then(function (j) {
          if (j && j.ok) return { ok: true };
          handleResp(j);
          return { ok: false, error: (j && j.error) || '保存失败' };
        });
    };
    bridge.run = function (action, params, body) {
      var q = '?action=run&name=' + encodeURIComponent(action);
      if (params) Object.keys(params).forEach(function (k) { q += '&' + k + '=' + encodeURIComponent(params[k]); });
      var opts = { method: 'POST', headers: authHeaders(), body: body || '{}' };
      return fetchJSON(API + q, opts).then(function (j) { return handleResp(j); });
    };

    /* ---------- 保存：按配置域推送真实后端（幂等，安全） ----------
     * 每个 wan 单独一条 network.wan job（后端 saveWan 单接口处理）；
     * 密码类（admin）仅当填写了新密码才推送，避免空密码触发后端报错。 */
    bridge.save = function () {
      var wanJobs = (mock.wanConfigs || []).map(function (w) {
        return {
          domain: 'network.wan',
          config: {
            id: wanId(w.name),
            proto: w.connType === 'Static' ? 'static' : w.connType === 'PPPoE' ? 'pppoe' : w.connType === 'PPTP' ? 'pptp' : w.connType === 'L2TP' ? 'l2tp' : 'dhcp',
            ip: w.ip, mask: w.mask, gateway: w.gateway, dns1: w.dns1, dns2: w.dns2, mtu: w.mtu,
            username: w.pppoeUser || '', password: w.pppoePass || '', mac: w.mac
          }
        };
      });
      var qosCfg = mock.qos || {};
      var lbCfg = {
        mode: (mock.loadBalance && mock.loadBalance.mode) || 'smart',
        lines: ((mock.loadBalance && mock.loadBalance.lines) || []).map(function (l) {
          return { id: wanId(l.wan), weight: l.weight || 1, active: !!l.joinDefault, interval: l.interval || 3, times: l.times || 3 };
        })
      };
      var aggCfg = {
        enable: !!(mock.bandwidthAgg && mock.bandwidthAgg.enabled),
        lines: ((mock.bandwidthAgg && mock.bandwidthAgg.lines) || []).map(function (l) {
          return { id: wanId(l.wan), weight: l.weight || 1, active: !!l.join };
        })
      };
      /* DDNS：前端记录用 wanIdx，后端 saveDdns 需要接口 id（wan→0, wan2→1 …） */
      var ddnsCfg = ((mock.ddns && mock.ddns.records) || []).map(function (r) {
        return {
          provider: r.provider || '3322-dy',
          username: r.username || '',
          password: r.password || '',
          domain: r.domain || '',
          wan: wanUcIdFromIdx(r.wanIdx),
          mx: r.mx || '',
          backupMx: !!r.backupMx
        };
      });
      var fwCfg = {
        connMax: (mock.connSettings && mock.connSettings.maxConn) || 0,
        portmaps: (mock.portMapRules || []).map(function (r) { return { external: r.extPort, internal: r.intPort || r.extPort, internalIp: r.intIp }; }),
        dmz: (mock.dmz && mock.dmz.enable) ? { enable: true, ip: mock.dmz.ip } : { enable: false, ip: '' },
        upnp: !!(mock.upnp && (mock.upnp.enabled !== undefined ? mock.upnp.enabled : mock.upnp.enable)),
        upnpSecure: !!(mock.upnp && mock.upnp.secure)
      };
      var arpCfg = (mock.arpBind || []).map(function (b) { return { mac: b.mac, ip: b.ip, name: b.name || '' }; });
      /* 行为管理-IP段限制：前端 start/end → 后端 ip（支持 单IP / a-b / CIDR / 通配） */
      var behCfg = {
        enable: !!(mock.ipLimit && mock.ipLimit.enabled),
        ipLimit: ((mock.ipLimit && mock.ipLimit.rules) || []).map(function (r) {
          var ip = (r.start || '') + (r.end && r.end !== r.start ? '-' + r.end : '');
          return { ip: ip };
        })
      };
      var polCfg = { routes: (mock.policyRoutes || []).map(function (r) { return { dest: (r.remoteIps && r.remoteIps[0]) || '', src: (r.hostIps && r.hostIps[0]) || '', interface: r.wans && r.wans[0] ? wanId(r.wans[0]) : 'wan' }; }) };
      var advCfg = mock.access || {};
      var adminCfg = mock.admin || {};
      var dhcpCfg = mock.dhcp || {};

      var jobs = wanJobs.concat([
        { domain: 'dhcp', config: dhcpCfg },
        { domain: 'qos', config: qosCfg },
        { domain: 'lb', config: lbCfg },
        { domain: 'agg', config: aggCfg },
        { domain: 'ddns', config: ddnsCfg },
        { domain: 'firewall', config: fwCfg },
        { domain: 'arp', config: arpCfg },
        { domain: 'behavior', config: behCfg },
        { domain: 'policy', config: polCfg },
        { domain: 'advanced', config: advCfg },
        { domain: 'dnsaudit', config: { enabled: !!mock.dnsAuditEnabled } }
      ]);
      /* 批8 新增写域：速度限制/连接限制/DDOS/私接DHCP/域名过滤/应用限制/端口触发/镜像/ARP防御/安全加固/静态路由/域名重定向/MAC设置/访问控制/带宽保证 */
      var cfgJobs = [
        ['speedlimit', { rules: mock.speedLimitRules || [] }],
        ['connlimit', { defaultConnLimit: mock.defaultConnLimit || 0, rules: mock.connLimitRules || [] }],
        ['ddos', { settings: mock.ddosSettings || {}, rules: mock.ddosRules || [] }],
        ['dhcpdetect', mock.dhcpDetect],
        ['domainfilter', { mode: mock.domainFilterMode || 'disable', rules: mock.domainFilterRules || [], audit: !!mock.domainFilterAudit, rebindProtect: !!mock.domainFilterRebindProtect }],
        ['applimit', { rules: mock.appLimitRules || [] }],
        ['porttrigger', { rules: mock.portTriggerRules || [] }],
        ['mirror', mock.mirrorPort],
        ['arpdefense', mock.arpDefense],
        ['wanharden', mock.wanHarden],
        ['staticroutes', { routes: mock.staticRoutes || [] }],
        ['domainredirect', { rules: mock.domainRedirectRules || [] }],
        ['macsettings', mock.macSettings],
        ['accessrules', { mode: mock.accessMode || 'disabled', rules: mock.accessRules || [] }],
        ['bandwidthguarantee', { rules: mock.bandwidthGuaranteeRules || [] }]
      ];
      cfgJobs.forEach(function (j) {
        if (j[1]) jobs.push({ domain: j[0], config: j[1] });
      });
      if (mock.sysName || mock.sysTime) {
        jobs.push({ domain: 'system', config: { name: mock.sysName || '', time: mock.sysTime || '' } });
      }
      if (adminCfg.newPass && adminCfg.newPass !== '') {
        jobs.push({ domain: 'admin', config: adminCfg });
      }
      jobs.forEach(function (job) {
        fetchJSON(API + '?action=set', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ domain: job.domain, config: job.config }) });
      });
    };

    adoptRealData();
  }

  /* ---------- 探测后端（auth check 无需登录也返回 ok） ---------- */
  fetchJSON(API + '?action=auth&name=check', { headers: authHeaders() }).then(function (j) {
    if (j && j.ok) {
      activateReal();
      var authed = !!(j.payload && j.payload.authenticated);
      if (bridge.onProbe) {
        bridge.onProbe({
          real: true,
          authed: authed,
          role: authed ? (j.payload.role || 'admin') : '',
          user: authed ? (j.payload.user || 'root') : ''
        });
      }
    } else {
      if (bridge.onProbe) bridge.onProbe({ real: false });
    }
  });
})();
