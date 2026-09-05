# 黄金定制 完整版 — 前后端数据契约 v6

> 本契约是「完整版」的核心：**前端演示内核**（浏览器 localStorage）与 **OpenWrt Lua 后端**（golden-api）实现同一套接口，前端代码不关心数据从哪来。

---

## 一、运行模式

| 模式 | 触发条件 | 数据来源 | 效果 |
|---|---|---|---|
| **演示模式** | 直接双击打开 `app/index.html` | 内置演示内核 + localStorage | 全部 50 个功能可操作、配置可保存、可"看着玩" |
| **真实模式** | 固件内访问 `192.168.1.1/golden/` | `golden-bridge.js` 自动探测 `/cgi-bin/golden-api`，成功即切换 | 配置真实写入 UCI/防火墙/服务，立即生效 |

前端通过 `window.__goldenBridge` 决定走哪条路：探测到后端 → 真实模式；否则 → 演示模式（顶部出现"演示模式"状态条）。

**真实数据全量架构（批8）**：登录成功后前端调用 `adoptRealData()` 一次拉取 `GET ?action=get&name=all`（后端 `GET_MAP` 聚合 30+ 配置域一次性返回），逐域回填前端 mock；WAN 以真实 UCI 接口 id（`wan`/`wan2`/`wan3`… 或自定义 `wan1`）标记为 `_ucId`，`wanId()` 优先取真实 id，并裁剪演示模式多余线路；保存时 `bridge.save()` 将 28 个写域逐个推送（每 WAN 独立推 `network.wan`、admin 域仅在填写新密码时推送）。此机制保证：**进入任何页面即显示路由器当前真实 UCI 数据**，无需逐个 get。

---

## 二、API 端点

```
GET /cgi-bin/golden-api?action=<action>&<params>
POST /cgi-bin/golden-api            (body: JSON 配置；upgrade/restore 用原始二进制或 base64 JSON)
```

返回格式统一：
- 成功：`{"ok": true, "payload": {...}}`
- 失败：`{"ok": false, "code": <int>, "error": "<msg>", "payload": {}}`
  - `code=401` 未登录/会话过期（前端触发重新登录）
  - `code=403` 访客只读权限（前端提示"访客账号为只读权限"）
  - 其他 code 为一般错误（默认 500）

## 二.5、认证与会话（真实模式）

真实模式强制登录后才能读写，**token 一律走请求头 `X-Golden-Token`**（不再接受 URL 参数、不进 body），杜绝 token 泄露到 uhttpd 访问日志 / Referer。

| 端点 | 说明 |
|---|---|
| `GET ?action=auth&name=check` | 会话探测（无需登录），返回 `{authenticated, role, user}`；前端用它判定「真实+已登录 / 真实+未登录 / 演示」 |
| `POST ?action=auth&name=login` body `{user, pass}` | 登录，校验 `/etc/shadow`，成功返回 `{token, role, user, firstLogin}` |
| `POST ?action=auth&name=logout` | 注销，销毁服务端会话文件 |

安全设计要点（v5 加固）：
- token 随机生成（/dev/urandom），服务端存 `/tmp/golden_sessions/`，超时自动失效（默认 15 分钟）
- **会话绑定来源 IP**：会话文件记录客户端 `REMOTE_ADDR`，换 IP 即作废（避免 token 被劫持后异地使用）
- 密码用 busybox `cryptpw` 按 `/etc/shadow` 的算法+salt 重算比对，**密码永不回传前端**
- **登录失败双保险**：应用层按 IP 计数（`/tmp/golden_lock`，默认 3 次/10 分钟锁定）+ 达阈值下发 iptables `golden_login` 链（`xt_recent` glb 表）**DROP 封禁 3600 秒**；`login-banlist` 查询 / `login-unban` 解封
- 写操作（action=set）强制要求 admin 角色，guest 一律 403
- **危险/有副作用操作强制 POST**（`requirePost()`）：GET 可被 `<img>`/`<script>` 跨站触发，POST 有 CSRF 天然防护；reboot/poweroff/reset/restartservice/backup/upgrade*/ctcnc-*/arplog-clear/dnsblock-clear/login-unban/block-ip/unblock-ip/dnsaudit-clear 均已强制
- 首次登录强制改密：`golden_first_login=1` 时登录返回 `firstLogin=true`，前端弹窗强制修改，改密后清除标志
- 登录用户名支持别名映射：WEB 访问设置里改「管理员」/「普通用户」用户名后，`golden_admin_user`/`golden_guest_user` 保存别名，登录时别名映射回 root/guest 系统账户校验
- 系统账户：root（admin，管理员）、guest（只读访客，`/bin/false` 禁止 SSH），由 `90-golden` 首次启动脚本创建

## 三、动作分类

### 1. 读取（GET action）

| action | 返回 data | 对应界面 |
|---|---|---|
| `all` | **全部配置域一次返回**（30+ 域聚合：network.wan/lan、dhcp、qos、lb、agg、ddns、speedlimit、bandwidthguarantee、connlimit、ddos、dhcpdetect、dhcpdetectlogs、lbstatus、policyroutes、firewall、behavior、accessrules、systemname、systemtime、staticroutes、domainredirect、macsettings、loginbanlist 等；登录后 `adoptRealData()` 一次拉全回填，所有页面进入即显示真实 UCI 数据） | 登录后全量回填 |
| `sysinfo` | cpu/mem/uptime/conns/temp | 运行状态 |
| `laninfo` | ip/mask/gw/dns/dhcp 池 | 状态概述-局域网 |
| `waninfo` | 全部 WAN 的 proto/ip/mac/mtu/status | 状态概述-广域网 / 网络设置 |
| `hosts` | DHCP 租约 + 在线主机（含速率） | 主机监控 |
| `arp` | /proc/net/arp 解析 | ARP 列表 |
| `arpbind` | /etc/ethers 静态绑定 | ARP 绑定 |
| `traffic` | 各接口收发速率/累计 + 协议分布 | 流量分析 |
| `conns` | conntrack 连接统计 | 运行状态/联线数 |
| `processes` | 主机进程（演示内核生成） | 主机监控-查看进程 |
| `logs` | logread + 分类日志 | 系统日志/各类日志 |
| `config` | 全部配置域（JSON） | 各配置页面初始化 |
| `dhcp` | DHCP 开关/池/网关/DNS/租约 | 网络设置-DHCP设置 |
| `ddns` | ddns 配置与状态 | DDNS设置 |
| `qos` | QoS 全部配置 | 带宽设置/速度限制/带宽保证 |
| `lb` | 负载均衡配置与线路状态 | 负载均衡/线路状态 |
| `agg` | 带宽叠加配置 | 带宽叠加 |
| `upnp` | UPnP 映射列表 + 安全状态（`{list, enabled, secure}`） | UPnP设置 |
| `access` | Web/SSH 访问设置（含管理员用户名与密码修改） | 高级管理 → 访问设置 |
| `speedlimit` | 速度限制规则（双向限速/时间控制/单IP/共享，含 wans[]） | 智能QoS → 速度限制 |
| `connlimit` | 连接限制（`defaultConnLimit` + rules 列表） | 安全设置 → 连接限制 |
| `ddos` | DDOS 防御（`settings{defaultConcurrent,defaultInterval}` + rules） | 安全设置 → DDOS攻击防御 |
| `dhcpdetect` | 私接 DHCP 探测配置（`{interval, intercept, alert}`） | 安全设置 → 私接DHCP探测 |
| `dhcpdetectlogs` | 私接 DHCP 探测日志（每行 `时间戳\|事件`，上限条数） | 系统工具 → 私接DHCP探测日志 |
| `domainfilter` | 域名过滤（`{mode: disable|filter|allow, rules: [{id, domain}], audit, rebindProtect}`） | 行为管理 → 域名过滤 |
| `applimit` | 应用限制（`{templates: {应用名→端口集}, rules: [...]}`） | 行为管理 → 应用限制 |
| `ctcnc` | 电信网通地址库（`{libraries: [{key, name, enabled, count, file}]}`） | 策略路由 → 电信网通地址 |
| `porttrigger` | 端口触发（`{rules: [{id, active, desc, protocol, triggerPort, mapPort}]}`） | 端口映射 → 端口触发 |
| `mirror` | 镜像端口（`{enabled, dir: all|out|in, mode: host|port, ip}`） | 高级管理 → 镜像端口 |
| `arpdefense` | ARP 安全防御（`{enabled, fakeGatewayEnabled, fakeGatewayInterval, illegalGatewayEnabled, illegalGatewayInterval, analysisLevel}`） | ARP管理 → ARP安全防御 |
| `arplogs` | ARP 防御日志（`/tmp/golden_arplog` 每行 `时间\|事件`，上限条数） | ARP管理 → ARP日志 |
| `wanharden` | WAN 安全加固（`{pingWan, ttlDrop, scanEnable, scanHitcount, scanSeconds}`） | 安全设置 → 安全加固 |
| `dnsblocklogs` | 域名拦截审计日志（`/tmp/golden_dnsblock.log` 每行 `时间\|客户端IP\|域名`，上限条数） | 行为管理 → 域名过滤 → 拦截审计日志 |
| `secevents` | 安全事件聚合（`{events: [{time, type, typeName, level, src, desc}]}`，参数 `limit`/`type` 筛选；聚合 ARP/域名拦截/私接DHCP/端口扫描/DDoS/连接超限/登录爆破七类） | 安全设置 → 安全事件中心 |
| `banlist` | 一键封禁黑名单（`{banned: ["1.2.3.4", ...]}`，读 UCI `golden.blocklist.ip`） | 安全设置 → 安全事件中心 → 封禁列表 |
| `dnsaudit` | 上网行为审计开关（`{enabled: bool}`） | 行为管理 → 上网行为审计 |
| `dnsauditlogs` | 全量 DNS 查询历史（`{logs: [{time, ip, domain}]}`，参数 `ip`/`limit` 按设备筛选；源 `/tmp/golden_dnsaudit.log`） | 行为管理 → 上网行为审计 |

### 2. 写入（POST 配置域）

POST body：`{"domain": "<域>", "config": {...}}`，返回 `{"ok":true}` 表示已保存并应用。

| domain | 对应界面 | Lua 后端实现（真实动作） |
|---|---|---|
| `network.wan` | 网络设置-广域网 | uci 写 network.wanN（proto/ipaddr/netmask/gateway/dns/mtu/mac）+ ifup |
| `network.lan` | 网络设置-局域网 | uci 写 network.lan + dhcp 池 + reload |
| `dhcp` | 网络设置-DHCP设置 | uci 写 dhcp.lan（ignore/start/limit/leasetime/dhcp_option）+ dnsmasq restart |
| `system` | 路由名称/时间 | uci system.@system[0] / date -s |
| `qos` | 带宽设置/速度限制/带宽保证 | 写 /etc/config/qos 或 SQM 配置 + sqm stop/start |
| `lb` | 负载均衡线路 | uci 写 mwan3 成员/策略 + mwan3 restart |
| `agg` | 带宽叠加 | 写 mwan3 多线策略 + 会话分配规则 |
| `ddns` | DDNS设置 | uci 写 ddns 记录 + 重启 ddns 服务 |
| `firewall` | 端口映射/DMZ/端口触发/联线限制/DDOS防御/私接DHCP探测/UPnP安全 | uci 写 firewall redirects/rules + fw4 reload + sysctl；`cfg.upnpSecure` → upnpd `secure_mode=1` + `acl_rule='deny 0-1023 0.0.0.0/0 0-65535'`（禁映射特权端口） |
| `arp` | ARP绑定/防御 | 写 /etc/ethers + uci dhcp static_lease + 防御开关 |
| `behavior` | 应用限制/访问控制/域名重定向/域名过滤/IP段限制 | uci 写 firewall rules（ipset/dnsmasq） + fw4 reload |
| `policy` | 策略路由/电信网通地址 | 写 mwan3 规则 + ipset 加载 |
| `advanced` | 访问设置（HTTP 端口/SSH 端口/远程访问/管理员/普通用户/安全策略）/MAC/镜像端口/路由表 | uci 写 system/uhttpd/dropbear + 防火墙放通 + uhttpd/dropbear 重启，SSH 认证密钥写 `/etc/dropbear/authorized_keys` |
| `admin` | 管理用户名/密码修改（已并入 advanced 域，前端独立菜单已移除） | `passwd root` 修改真实系统密码 + uci 保存用户名别名 |
| `speedlimit` | 智能QoS → 速度限制 | 清空旧段 → 逐规则校验 → uci 写 `golden.speedrule_N`（single 模式按 IP 展开 / share 模式存范围）→ `sh /etc/golden/speedlimit.sh restart`（tc htb + ifb 双向限速） |
| `connlimit` | 安全设置 → 连接限制 | uci 写 `golden.connlimit.default_limit` + `golden.connrule_N`（mask/limit/time 段）→ `sh /etc/golden/connlimit.sh restart`（iptables connlimit，TCP REJECT 其余 DROP） |
| `ddos` | 安全设置 → DDOS攻击防御 | uci 写 `golden.ddos.default_concurrent/interval` + `golden.ddosrule_N` → `sh /etc/golden/ddos.sh restart`（connlimit 限 SYN + sysctl 内核加固 7 项） |
| `dhcpdetect` | 安全设置 → 私接DHCP探测 | uci 写 `golden.dhcpdetect.interval/intercept/alert` → `/etc/init.d/golden-dhcpdetect restart`（logread 守护捕获非本机 DHCP OFFER，可 DROP） |
| `domainfilter` | 行为管理 → 域名过滤 | 清空旧 `domfilter_N` 段 → 规范化域名（去 `*`/空白/首尾点）写 `golden.domfilter_N` + `golden.domainfilter.mode` + `audit`（拦截审计开关）+ `rebind_protect`（DNS 防投毒，默认开）→ `sh /etc/golden/domainfilter.sh restart`（dnsmasq 直接阻断：`address=/域名/0.0.0.0`，allow 白名单 `address=/#/` 全局污染 + `server=/域名/` 恢复；audit=1 时写 `log-queries=extra` + `log-facility=/tmp/dnsmasq.log`；rebind=1 时写 `stop-dns-rebind`）→ `dnsaudit.sh restart`（守护 tail dnsmasq 日志，命中黑名单写 `/tmp/golden_dnsblock.log`） |
| `applimit` | 行为管理 → 应用限制 | 逐规则校验 IP 范围（parseRange）→ 内置 APP_PORTS 模板把应用名展开为 multiport 端口集（上限 12 项）→ 写 `golden.apprule_N`（active/desc/range/rstart/rend/ports/apps/timecontrol/timeslots）→ `sh /etc/golden/applimit.sh restart`（iptables multiport + iprange 源匹配 DROP，`-m time` 时间控制） |
| `ctcnc` | 策略路由 → 电信网通地址 | 写各 `golden.ctcnc_<key>.enabled`；可选随配置 `cfg.import = {key, lines[]}` 导入 CIDR 到 `/etc/golden/iplib/<key>.txt` → `sh /etc/golden/ctcnc.sh restart`（ipset hash:net + mangle MARK + ip rule 分流到独立路由表） |
| `porttrigger` | 端口映射 → 端口触发 | 清空旧 `porttrigger_N` → 校验触发/映射端口（`portItemOk`：端口或起-止）→ 写 `golden.porttrigger_N`（active/desc/proto/trigger/map）→ `sh /etc/golden/porttrigger.sh restart`（iptables SET 记录触发源 IP → ipset hash:ip timeout 600 → 外部访问映射端口时校验放行） |
| `mirror` | 高级管理 → 镜像端口 | 校验 dir/mode → 写 `golden.mirror.enabled/dir/mode/ip` → `sh /etc/golden/mirror.sh restart`（tc mirred egress mirror 把 WAN 出入流量镜像到 br-lan，防环路） |
| `arpdefense` | ARP管理 → ARP安全防御 | 校验区间/级别 → 写 `golden.arpdefense.enabled/fakegateway/fakeinterval/illegalgateway/illegalinterval/level` → `sh /etc/golden/arpdefense.sh restart`（/etc/ethers 绑定 → iptables -m mac 放行绑定 MAC + 其余 DROP → ip neigh replace permanent 锁定网关 → arping -U 免费 ARP 防伪网关 → 守护轮询 /proc/net/arp 记非法接入） |
| `wanharden` | 安全设置 → 安全加固 | 校验 hit 5-500 / sec 10-3600 → 写 `golden.wanharden.ping_wan/ttl_drop/scan_enable/scan_hitcount/scan_seconds` → `sh /etc/golden/wanharden.sh restart`（WAN 禁 Ping：input_wan 丢弃 icmp echo-request；防 traceroute：`-m ttl --ttl-eq 1 -j DROP`；端口扫描检测：xt_recent 窗口内 SYN 达阈值 → LOG `GOLDEN-SCAN` + DROP） |
| `dnsaudit` | 行为管理 → 上网行为审计 | 写 `golden.dnsaudit.enabled` → `sh /etc/golden/dnsaudit.sh restart`（守护确保 dnsmasq `log-queries=extra` + `log-facility=/tmp/dnsmasq.log`，增量跟踪查询 → 全量写 `/tmp/golden_dnsaudit.log` 5000 行截断；命中黑名单追加 `/tmp/golden_dnsblock.log` 2000 行截断） |

### 3. 操作（GET action + 参数；v6 起除 `ping` 外全部强制 POST）

> **CSRF 防护**：reboot/poweroff/reset/restartservice/backup/restore/upgrade/upgrade-confirm/ctcnc-*/arplog-clear/dnsblock-clear/login-unban/block-ip/unblock-ip/dnsaudit-clear 均要求 `POST` 请求（GET 可被 `<img>`/`<script>` 跨站触发），token 走 `X-Golden-Token` 头。

| action | 参数 | 演示内核行为 | Lua 后端真实行为 |
|---|---|---|---|
| `ping` | host | 3 秒后返回模拟丢包/延迟 | 调用 `/bin/ping` 真实结果（只读，允许 GET） |
| `reboot` | - | 倒计时提示"已重启" | `reboot` |
| `poweroff` | - | 提示关机 | `poweroff` |
| `reset` | - | 清空 localStorage 恢复出厂 | `firstboot && reboot` |
| `upgrade` | 原始二进制 body | 模拟上传进度 | POST 分块写 `/tmp/golden-fw.bin`（大小校验 1MB–64MB）→ `sysupgrade -T` 完整性预检，失败即取消并读日志回报；成功返回 `{verified, size, md5}`，前端提示输入 `yes` 二次确认 |
| `upgrade-confirm` | - | 提示"已重启" | 确认预检文件存在 → `nohup sysupgrade &`（保留配置升级）→ `{rebooting: true}` |
| `backup` | - | 下载演示 JSON 文件 | `tar czf /tmp/golden-backup.tar.gz /etc/config /etc/golden` → 返回 `{filename, size, b64}`（base64 编码传输，杜绝 shell 注入） |
| `restore` | POST body `{fname, b64}` | 导入演示 JSON | base64 -d 写 `/tmp/golden-restore.tar.gz` → `tar tzf` 清单白名单校验（拒绝 `/`、`../`，仅允许 `etc/config`、`etc/golden`）→ 恢复前自动 tar 备份当前配置 → 解压还原 + network/dnsmasq/firewall reload |
| `saveapply` | domain | 写入 localStorage | 对应 domain 的真实应用动作 |
| `restartservice` | service(upnp/ddns/sqm/mwan3) | 提示已重启 | 对应 service restart |
| `ctcnc-default` | key（ct/cnc/tietong/edu/custom1-3） | 模拟随机条数 | 写内置 `DEFAULT_IPLIB` 精简默认表到 `/etc/golden/iplib/<key>.txt` + 启用 + ctcnc.sh restart → `{imported, key}` |
| `ctcnc-download` | key | 模拟条数 | `wget -T 20` 从 `IPLIB_URL`（gaoyifan/china-operator-ip ip-lite 精简表）下载 → 校验 CIDR 写入 → 启用 → restart → `{imported, key}`（失败返回具体原因） |
| `ctcnc-import` | POST body `{key, lines[]}`（≤2MB） | 模拟条数 | 逐行校验 `x.x.x.x/n` → 写库 → 启用 → restart → `{imported, key}` |
| `arplog-clear` | - | 清空演示日志 | `rm -f /tmp/golden_arplog` → `{cleared: true}` |
| `login-banlist` | - | 返回空列表 | 读 `/proc/net/xt_recent/glb` 提取 `src=` IP → `{banned: ["1.2.3.4", ...]}`（登录爆破封禁查询） |
| `login-unban` | ip | 演示移除 | `iptables -D golden_login ...` 移除 recent 标记 + `sed` 清内核表 + 删应用层失败计数 → `{unbanned: ip}` |
| `dnsblock-clear` | - | 清空演示日志 | `rm -f /tmp/golden_dnsblock.log` → `{cleared: true}`（域名拦截审计清空） |
| `block-ip` | ip | 演示写入 banList | POST；`golden.blocklist` UCI 列表去重追加 + iptables `golden_block` 链 `-s IP -j DROP`（幂等建链，挂 FORWARD/INPUT 拦截全部流量）→ `{blocked: ip}` |
| `unblock-ip` | ip | 演示移除 banList | POST；`uci del_list golden.blocklist.ip` + `iptables -D golden_block -s IP -j DROP` → `{unblocked: ip}` |
| `dnsaudit-clear` | - | 清空演示日志 | `rm -f /tmp/golden_dnsaudit.log` → `{cleared: true}`（上网行为审计清空） |

---

## 四、配置域数据结构（节选）

```json
{
  "network.wan": [{"id":"wan1","proto":"pppoe","username":"","password":"","ip":"0.0.0.0","mask":"0.0.0.0","gw":"0.0.0.0","dns":"","mtu":1500,"mac":""}],
  "network.lan": {"ip":"192.168.1.1","mask":"255.255.255.0","dhcpStart":"100","dhcpEnd":"254","dhcpLease":"12h"},
  "dhcp": {"enabled":false,"start":"192.168.1.100","end":"192.168.1.200","gateway":"192.168.1.1","dns1":"223.5.5.5","dns2":"223.6.6.6","lease":86400},
  "qos": {"wan":"wan1","up":"100","down":"200","smin":5,"xmin":10,"exceptions":[{"type":"ip","value":"192.168.1.10"}]},
  "lb": {"mode":"smart","lines":[{"id":"wan1","weight":1,"active":true,"detect":true,"interval":3,"times":3}]},
  "agg": {"enable":true,"mode":"smart","lines":[{"id":"wan1","weight":1,"ratio":50}]},
  "ddns": [{"id":1,"wan":"wan1","ipMode":"wan","provider":"3322.org","user":"","pass":"","domain":"","mx":"","backupMx":""}],
  "firewall": {"connMax":65535,"portmaps":[],"dmz":{"enable":false,"ip":""},"upnp":false,"upnpSecure":false,"ddos":{}},
  "arp": {"bindings":[{"ip":"192.168.1.2","mac":"00:11:22:33:44:55","name":"pc1"}],"defense":true},
  "behavior": {"ipLimit":[],"access":[],"domainRedirect":[],"domainFilter":[]},
  "policy": {"routes":[]},
  "advanced": {"access":{},"macClone":"","mirrorPort":0,"staticRoutes":[]},
  "access": {"httpPort":80,"remoteAccess":false,"remotePort":8080,"remoteAllow":"","adminUser":"root","adminPass":"","guestUser":"guest","guestPass":"","loginLock":5,"sessionTimeout":15,"ssh":{"enabled":false,"localPort":22,"remoteAccess":false,"remotePort":2222,"passwordAuth":true,"authKey":""}},
  "admin": {"oldUser":"root","newUser":"root","oldPass":"","newPass":"","newPassConfirm":""},
  "system": {"name":"黄金定制","timezone":"Asia/Shanghai"},
  "domainfilter": {"mode":"disable","rules":[{"id":1,"domain":"*.sex.com"}],"audit":false,"rebindProtect":true},
  "applimit": {"rules":[{"id":1,"active":true,"desc":"禁止办公区下载","range":"192.168.10.100-192.168.10.150","apps":["迅雷","BitTorrent"],"timeControl":false,"timeSlots":""}]},
  "ctcnc": {"libraries":[{"key":"ct","name":"电信","enabled":true,"count":4321,"file":"ct.txt"}]},
  "porttrigger": {"rules":[{"id":1,"active":true,"desc":"网络游戏","protocol":"tcp","triggerPort":"3724","mapPort":"3724-4000"}]},
  "mirror": {"enabled":false,"dir":"all","mode":"host","ip":""},
  "arpdefense": {"enabled":true,"fakeGatewayEnabled":true,"fakeGatewayInterval":200,"illegalGatewayEnabled":true,"illegalGatewayInterval":10,"analysisLevel":"中"},
  "wanharden": {"pingWan":false,"ttlDrop":false,"scanEnable":false,"scanHitcount":30,"scanSeconds":60},
  "dnsaudit": {"enabled":false},
  "blocklist": {"ip":["1.2.3.4","5.6.7.8"]},
  "secevents": {"events":[{"time":"2026-09-01 16:00:00","type":"scan","typeName":"端口扫描","level":"high","src":"8.8.8.8","desc":"检测到端口扫描，目标端口 3389，来源已被拦截"}]},
  "dnsauditlogs": {"logs":[{"time":"2026-09-01 16:00:01","ip":"192.168.10.99","domain":"www.example.com"}]}
}
```

---

## 五、前端接入点

```js
window.__goldenBridge = {
  mode: 'demo' | 'real',        // 自动探测
  token: '',                    // 会话 token（localStorage 持久化，请求时写入 X-Golden-Token 头）
  login(user, pass),            // 真实模式登录，成功返回 {ok, role, user, firstLogin}
  logout(),                     // 注销并清除本地 token
  get(action, params) {...},    // 读取（自动附带 token 头）
  set(domain, config) {...},    // 保存并应用（POST + token 头，body 不含 token）
  run(action, params) {...},    // 执行操作（v5 起全 POST + token 头，body 不含 token）
  onProbe({real, authed, role, user}),  // 探测回调：驱动登录页显示
  onAuthRequired(),             // 401 回调：回到登录页
  onForbidden(msg),             // 403 回调：只读提示
  onStatus(cb)                  // 订阅状态变化（真实模式轮询）
};
```

演示模式由 `golden-kernel.js` 实现同一接口（localStorage 持久化 + 模拟系统行为），`login` 跳过、token 为空。
