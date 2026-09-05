/* 黄金定制 — 双模式冒烟测试（#73 前端回填补全验证）
 * 用法: node test/smoke.js （须在工程根目录运行）
 * 1) 演示模式：加载 index.html + kernel + bridge（探测失败 → 保持 demo）
 * 2) 真实模式：stub fetch 模拟 golden-api → login → adoptRealData 回填 → bridge.save 推送域断言
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const APP = path.join(__dirname, '..', 'app');
let failures = 0;
function ok(cond, msg) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
  if (!cond) failures++;
}

/* ---------- 构造模拟后端 all 载荷（形状与 golden-api 批8 完全一致） ---------- */
function makeAllPayload() {
  return {
    sysinfo: { runTime: '2天3时', currentConn: 1234, connCapacity: '614000', cpuModel: 'Intel N100', memTotalG: '1.9', memFreeG: '1.2' },
    laninfo: { ip: '192.168.10.1', mask: '255.255.255.0', mac: '00:0e:04:87:db:8f' },
    waninfo: [
      { id: 'wan', proto: 'static', ifname: 'eth0', ip: '183.167.196.35', mask: '255.255.255.0', gateway: '183.167.196.1', mac: '00:0e:04:87:d9:4e', mtu: '1500', dns1: '202.102.192.68', dns2: '202.102.199.68', status: '在线' },
      { id: 'wan2', proto: 'dhcp', ifname: 'eth1', ip: '10.12.5.88', mask: '255.255.255.0', gateway: '10.12.5.1', mac: '00:0e:04:87:da:2f', mtu: '1500', dns1: '223.5.5.5', dns2: '223.6.6.6', status: '在线' }
    ],
    hosts: [{ name: 'zhangsan', ip: '192.168.10.66', mac: '52:54:00:12:35:0a', client: 'Windows 10', status: '在线' }],
    arp: { list: [{ ip: '192.168.10.66', mac: '52:54:00:12:35:0a', interface: 'br-lan', type: '动态', status: '在线' }], bindings: [{ mac: '52:54:00:12:35:0a', ip: '192.168.10.66', name: 'zhangsan' }] },
    traffic: [{ name: 'eth0', rxBytes: 1000, txBytes: 800, rxPackets: 100, txPackets: 80 }],
    conns: { total: 1234, tcp: 900, udp: 300, icmp: 20 },
    logs: [{ time: '2026-08-31 16:00:00', type: '系统', content: '登录成功', source: '192.168.10.1' }],
    loginusers: [{ user: 'root', ip: '192.168.10.1', time: '2026-08-31 16:00:00' }],
    domainresolve: [],
    access: { httpPort: 80, remoteAccess: false, remotePort: 8080, remoteAllow: '', adminUser: 'root', guestUser: 'guest', loginLock: 5, sessionTimeout: 15, ssh: { enabled: true, localPort: 22, remoteAccess: false, remotePort: 2222, passwordAuth: true, authKey: '' } },
    admin: { username: 'root' },
    dhcp: { enabled: false, start: '192.168.10.100', end: '192.168.10.200', gateway: '192.168.10.1', dns1: '223.5.5.5', dns2: '223.6.6.6', lease: 86400 },
    domainfilter: { mode: 'disable', rules: [], audit: false, rebindProtect: true },
    applimit: { rules: [], templates: {} },
    ctcnc: { libraries: [{ key: 'ct', name: '电信', enabled: true, count: 4321, file: 'ct.txt' }] },
    porttrigger: { rules: [] },
    mirror: { enabled: false, dir: 'all', mode: 'host', ip: '' },
    arpdefense: { enabled: false, fakeGatewayEnabled: true, fakeGatewayInterval: 200, illegalGatewayEnabled: true, illegalGatewayInterval: 10, analysisLevel: '中' },
    arplogs: [],
    wanharden: { pingWan: false, ttlDrop: false, scanEnable: false, scanHitcount: 30, scanSeconds: 60 },
    dnsblocklogs: [],
    upnp: { list: [], enabled: true, secure: false },
    /* ===== 批8 全量域 ===== */
    qos: { enabled: true, mode: 'smart', wans: [{ name: '广域网1', reference: '限速 20M/100M', up: 20480, down: 102400, smin: 5, xmin: 10, status: '在线', upUsage: 32, downUsage: 67 }, { name: '广域网2', reference: '不设置', up: 0, down: 0, smin: 5, xmin: 10, status: '在线', upUsage: 0, downUsage: 0 }], exceptions: { ip: [{ value: '218.22.21.12', note: '游戏服务器' }], domain: [{ value: 'ntp.pool.org', note: '时间同步' }] } },
    loadbalance: { mode: 'ip', lines: [{ wan: '广域网1', joinDefault: true, weightType: 'reference', weight: 1, detect: true, interval: 10, times: 5, failAction: '仅记录到日志', noDetectDown: 0, detectGw: false, gwIp: '', detectRemote: false, remoteAddr: 'www.baidu.com' }] },
    bandwidthagg: { enabled: false, mode: 'smart', lines: [{ wan: '广域网1', join: true, up: 0, down: 0, weight: 1 }] },
    ddns: { selectedIndex: -1, current: null, records: [{ id: 1, wanIdx: 0, ipMode: 'wan', customIp: '', provider: '3322-dy', username: 'u1', password: '', domain: 'my.3322.org', mx: '', backupMx: false, lastIp: '183.167.196.35', status: '已启用' }] },
    speedlimit: [{ id: 1, active: true, desc: '办公区限速', mode: 'share', up: 2048, down: 8192, wans: ['WAN1'], range: '192.168.10.100-192.168.10.150', timeControl: false, timeSlots: '' }],
    bandwidthguarantee: { rules: [{ id: 1, active: true, desc: '财务系统', mode: 'exclusive', up: 512, down: 2048, wans: ['WAN1'], range: '192.168.10.50', timeControl: true, timeSlots: '09:00-18:00' }] },
    connlimit: { defaultConnLimit: 500, rules: [{ id: 1, active: true, desc: '服务器区', range: '192.168.10.50-192.168.10.80', limit: 500, timeControl: false, timeSlots: '' }] },
    ddos: { settings: { defaultConcurrent: 500, defaultInterval: 1 }, rules: [] },
    dhcpdetect: { interval: 30, intercept: false, alert: '日志' },
    dhcpdetectlogs: [],
    lbstatus: [{ wan: '广域网1', status: '联机', weight: 1, defaultLB: '参与', detect: '测试成功', hosts: 12, sessions: 1234 }, { wan: '广域网2', status: '联机', weight: 1, defaultLB: '参与', detect: '测试成功', hosts: 8, sessions: 892 }],
    policyroutes: [{ id: 1, active: true, log: true, desc: '游戏加速', order: 1, wans: ['广域网1'], hostIps: ['192.168.10.100-192.168.10.120'], remoteIps: [], remoteDomains: ['*.game.com'], protocol: '', timeControl: false, timeSlots: '' }],
    firewall: { connMax: 614000, portmaps: [{ extPort: '21', intPort: '21', intIp: '192.168.10.50' }], dmz: { enable: false, ip: '' }, upnp: { enabled: true, secure: false } },
    behavior: { enable: false, ipLimit: [] },
    accessrules: { mode: 'disabled', rules: [{ id: 1, active: true, log: true, desc: '防病毒', action: '禁止通过', order: 1, range: '192.168.10.2-192.168.10.11', remoteIp: '', remoteDomain: '', protocol: '', timeControl: false, timeSlots: '' }] },
    systemname: { name: 'GoldenRouter' },
    systemtime: { time: '2026-08-31 16:00:00', zone: 'Asia/Shanghai' },
    staticroutes: [{ desc: '分公司', dest: '192.168.30.0', mask: '255.255.255.0', gateway: '192.168.10.254', metric: 0, iface: 'lan' }],
    domainredirect: { rules: [{ id: 1, active: true, log: false, desc: '广告过滤', urlHost: '*.ad.com', targetUrl: '/', urlParam: '', redirectTo: '127.0.0.1', appendUrl: false, range: '', timeControl: false, timeSlots: '' }] },
    macsettings: { pcMac: '00:1a:2b:3c:4d:5e', lanDefault: '00:0e:04:87:db:8f', lanMac: '00:0e:04:87:db:8f', wans: [{ name: '广域网1', default: '00:0e:04:87:d9:4e', current: '00:0e:04:87:d9:4e' }] },
    loginbanlist: { banned: ['103.45.67.89'] },
    secevents: { events: [] },
    banlist: { banned: [] },
    dnsaudit: { enabled: false },
    dnsauditlogs: { logs: [] }
  };
}

async function run() {
  /* ================= 1. 演示模式 ================= */
  console.log('\n[1] 演示模式（探测失败 → 保持 demo）');
  const demoDom = await JSDOM.fromFile(path.join(APP, 'index.html'), {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({ ok: false }) });
    }
  });
  await new Promise(r => setTimeout(r, 1200));
  const demoWin = demoDom.window;
  const demoErrors = [];
  demoWin.addEventListener('error', e => demoErrors.push(e.message));
  await new Promise(r => setTimeout(r, 600));
  const demoBridge = demoWin.__goldenBridge;
  ok(demoBridge && demoBridge.mode === 'demo', '演示模式生效（bridge.mode=demo）');
  ok(demoBridge.mockRef && demoBridge.mockRef.wanConfigs.length >= 2, 'mock 数据就绪');
  ok(demoErrors.length === 0, '演示模式无 JS 报错' + (demoErrors.length ? ': ' + demoErrors[0] : ''));
  demoDom.window.close();

  /* ================= 2. 真实模式 ================= */
  console.log('\n[2] 真实模式（stub golden-api → 登录 → 回填 → 保存）');
  let setCalls = [];
  const payload = makeAllPayload();
  const realDom = await JSDOM.fromFile(path.join(APP, 'index.html'), {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      // stub fetch：auth/check、auth/login、get all、action=set 记录
      window.fetch = function (url, opts) {
        url = String(url);
        opts = opts || {};
        const respond = data => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
        if (url.indexOf('action=auth&name=check') >= 0) {
          return respond({ ok: true, payload: { authenticated: false } });
        }
        if (url.indexOf('action=auth&name=login') >= 0) {
          return respond({ ok: true, payload: { token: 'test-token', role: 'admin', user: 'root', firstLogin: false } });
        }
        if (url.indexOf('action=get&name=all') >= 0) {
          return respond({ ok: true, payload });
        }
        if (url.indexOf('action=set') >= 0 && opts.body) {
          try { setCalls.push(JSON.parse(opts.body)); } catch (e) {}
          return respond({ ok: true, payload: { saved: true } });
        }
        if (url.indexOf('action=run') >= 0) return respond({ ok: true, payload: {} });
        return respond({ ok: false });
      };
    }
  });
  const win = realDom.window;
  const realErrors = [];
  win.addEventListener('error', e => realErrors.push(e.message));

  await new Promise(r => setTimeout(r, 1200)); // 等 bridge 探测完成

  const bridge = win.__goldenBridge;
  ok(bridge && bridge.mode === 'real', '探测成功 → bridge.mode=real');

  // 登录（触发 adoptRealData）
  const lr = await bridge.login('root', 'x');
  ok(lr && lr.ok === true, '登录成功（token 下发）');
  await new Promise(r => setTimeout(r, 400)); // 等 all 回填异步完成

  const m = bridge.mockRef;
  ok(m.qos.mode === 'smart' && m.qos.wans.length === 2, 'qos 回填（mode + 2 条线路）');
  ok(m.loadBalance.lines[0].wan === '广域网1' && m.loadBalance.lines[0].joinDefault === true, 'loadbalance 回填');
  ok(m.bandwidthAgg.enabled === false, 'bandwidthagg 回填');
  ok(m.ddns.records.length === 1 && m.ddns.records[0].provider === '3322-dy', 'ddns 回填');
  ok(m.speedLimitRules.length === 1 && m.speedLimitRules[0].up === 2048, 'speedlimit 回填');
  ok(m.bandwidthGuaranteeRules.length === 1, 'bandwidthguarantee 回填');
  ok(m.defaultConnLimit === 500 && m.connLimitRules.length === 1, 'connlimit 回填');
  ok(m.ddosSettings.defaultConcurrent === 500, 'ddos 回填');
  ok(m.dhcpDetect.interval === 30 && m.dhcpDetect.alert === '日志', 'dhcpdetect 回填');
  ok(m.lineStatus.length === 2 && m.lineStatus[0].status === '联机', 'lbstatus 回填');
  ok(m.policyRoutes.length === 1 && m.policyRoutes[0].wans[0] === '广域网1', 'policyroutes 回填');
  ok(m.portMapRules.length === 1 && m.portMapRules[0].extPort === '21', 'firewall→portMapRules 回填');
  ok(m.connSettings.maxConn === 614000, 'firewall→connSettings 回填');
  ok(m.upnp.enabled === true, 'firewall→upnp 回填');
  ok(m.accessMode === 'disabled' && m.accessRules.length === 1, 'accessrules 回填');
  ok(m.sysName === 'GoldenRouter', 'systemname 回填');
  ok(m.sysTime === '2026-08-31 16:00:00', 'systemtime 回填');
  ok(m.staticRoutes.length === 1 && m.staticRoutes[0].dest === '192.168.30.0', 'staticroutes 回填');
  ok(m.domainRedirectRules.length === 1 && m.domainRedirectRules[0].redirectTo === '127.0.0.1', 'domainredirect 回填');
  ok(m.macSettings.wans.length >= 1, 'macsettings 回填');
  ok(m.loginBanList.length === 1 && m.loginBanList[0] === '103.45.67.89', 'loginbanlist 回填');
  ok(m.ipLimit.enabled === false, 'behavior 回填');
  ok(m.wanConfigs[0]._ucId === 'wan' && m.wanConfigs[0].name === '广域网1', 'waninfo 回填携带真实接口 id');
  ok(m.wanConfigs[1]._ucId === 'wan2', '第二线路接口 id=wan2');

  // 保存推送断言
  setCalls = [];
  bridge.save();
  await new Promise(r => setTimeout(r, 300));
  const domains = setCalls.map(c => c.domain);
  const want = ['network.wan', 'dhcp', 'qos', 'lb', 'agg', 'ddns', 'firewall', 'arp', 'behavior', 'policy', 'advanced', 'dnsaudit',
    'speedlimit', 'connlimit', 'ddos', 'dhcpdetect', 'domainfilter', 'applimit', 'porttrigger', 'mirror', 'arpdefense',
    'wanharden', 'staticroutes', 'domainredirect', 'macsettings', 'accessrules', 'bandwidthguarantee', 'system'];
  const missing = want.filter(d => domains.indexOf(d) < 0);
  ok(missing.length === 0, 'bridge.save 推送全部 ' + want.length + ' 个域' + (missing.length ? '，缺: ' + missing.join(',') : ''));
  ok(domains.filter(d => d === 'network.wan').length === 2, '每个广域网独立推送 network.wan（2 条）');
  ok(domains.indexOf('admin') < 0, '未填新密码 → 不推送 admin 域（防空密码报错）');
  const wanJob = setCalls.find(c => c.domain === 'network.wan');
  ok(wanJob && wanJob.config.id === 'wan' && wanJob.config.proto === 'static', 'wan job 使用真实接口 id=wan / proto=static');
  const ddnsJob = setCalls.find(c => c.domain === 'ddns');
  ok(ddnsJob && ddnsJob.config[0].wan === 'wan', 'DDNS wanIdx=0 → 接口 wan');
  const behJob = setCalls.find(c => c.domain === 'behavior');
  ok(behJob && behJob.config.enable === false, 'behavior enable 读 mock.ipLimit.enabled');
  ok(realErrors.length === 0, '真实模式无 JS 报错' + (realErrors.length ? ': ' + realErrors[0] : ''));
  realDom.window.close();

  console.log('\n' + (failures === 0 ? '全部通过 ✔' : failures + ' 项失败 ✘'));
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
