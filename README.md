# 黄金定制 软路由 — 完整版（golden-full）

> 把你打磨的**黄金定制界面全部 50 个功能**做成真软路由：本地先"看着玩"，编译进固件后**配置真实写入 OpenWrt 并即时生效**。

---

## 一、两种用法

| 用法 | 怎么做 | 效果 |
|---|---|---|
| **① 本地看着玩** | 双击打开 `app/index.html` | 浏览器直接体验全部功能：点「以演示模式进入」→ 改配置、点保存、重启/关机/升级/恢复出厂都有真实反馈，配置存本地不丢 |
| **② 编译进固件** | 上传本工程到 GitHub → Actions 云编译 → 写 U 盘 | 开机进 `192.168.1.1/golden/`，**真实登录**（root/admin，首次登录强制改密），界面自动切换**真实模式**：保存的配置写入 UCI 并重启对应服务 |

> 真实模式带完整登录认证：root（管理员）可读写、guest（只读访客，默认密码 guest）只能查看；会话 token 自动续期，登录失败超 5 次按 IP 锁定 15 分钟。界面右上角显示当前用户；访客登录时页面顶部出现黄色只读横幅、提交按钮隐藏。

---

## 二、界面功能全覆盖（10 大模块 / 50 个页面）

| 模块 | 页面 | 真实后端动作 |
|---|---|---|
| 系统信息 | 运行状态 / 状态概述 / 流量分析 / 主机监控 / 登录用户 | 读 /proc、dhcp.leases、logread、conntrack |
| 基本设置 | 网络设置（广域网/局域网/DHCP）/ 路由名称 / 时间 / DDNS / 域名特殊解析 | uci 写 network/dhcp/ddns，reload 生效 |
| 智能QoS | 带宽设置 / 速度限制 / 带宽保证 | sqm 配置 + **tc htb + ifb 双向限速**（上行出方向 / 下行 ifb 镜像，iptables mark 分类，`-m time` 内核级时间控制） |
| 安全设置 | 联线数设置 / 连接限制 / DDOS防御 / 私接DHCP探测 / **安全加固** / **安全事件中心** | sysctl + **iptables connlimit 单 IP 限额**（TCP REJECT 其余 DROP）+ **logread 守护探测私接 DHCP OFFER**（可拦截）+ **WAN 隐身（禁 Ping/防 traceroute）+ 端口扫描检测 + 登录爆破 iptables 封禁** + **七类安全告警统一聚合（时间线/级别/来源/一键封禁）** |
| 行为管理 | 应用限制 / 访问控制 / 域名重定向 / 域名过滤 / **上网行为审计** / IP段限制 | firewall 规则 + ipset，fw4 reload；**应用限制 = iptables multiport+iprange 按内置模板拦截 P2P/QQ 等**；**域名过滤 = dnsmasq 解析污染直阻断（filter/allow 双模式）**；**上网行为审计 = 记录每台设备的全部 DNS 查询历史** |
| ARP管理 | ARP安全防御 / ARP绑定 / ARP列表 / ARP日志 | 写 /etc/ethers + dhcp 静态租约；**ARP 防御 = MAC 绑定放行 + 网关 MAC 静态锁定 + arping 免费 ARP 防伪网关 + 守护轮询告警日志** |
| 策略路由 | 负载均衡 / 带宽叠加 / 电信网通地址 / 策略路由 / 线路状态 / 日志 | uci 写 mwan3 成员/策略/规则，mwan3 restart；**电信网通地址 = ipset 运营商地址库 + fwmark 分流到独立路由表（支持在线下载/默认表/自定义上传）** |
| 端口映射 | 端口映射 / DMZ / 端口触发 / UPnP | uci 写 firewall redirects + miniupnpd；**端口触发 = ipset 记录触发源 IP，超时自动关闭映射端口** |
| 高级管理 | 访问设置（WEB/SSH/其他） / MAC地址设置 / 镜像端口 / 端口状态 / 路由表 / 系统控制 / 固件升级 | uci 写 uhttpd/dropbear/network + 系统操作；**镜像端口 = tc mirred 把 WAN 出入流量镜像到局域网主机** |
| 系统工具 | Ping / 各类日志 | 真实 ping、logread 分类日志 |

---

## 三、数据契约

前端（演示内核 / 真实桥接）与后端统一走 `docs/data-contract.md` 定义的接口：

- `GET ?action=get&name=all` → **登录后一次拉全全部配置域（30+ 域）**，回填到前端数据模型，所有页面进入即显示真实 UCI 数据（批8 全量真实化）
- `GET ?action=get&name=sysinfo|laninfo|waninfo|hosts|arp|arpbind|traffic|conns|logs|processes|upnp|ddns|qos|lb|agg|access|admin|dhcp|speedlimit|connlimit|ddos|dhcpdetect|dhcpdetectlogs|domainfilter|applimit|ctcnc|porttrigger|mirror|arpdefense|arplogs|wanharden|dnsblocklogs|secevents|banlist|dnsaudit|dnsauditlogs`
- `POST {domain, config}` → 真实写入 UCI（network/dhcp/qos/lb/agg/ddns/firewall/arp/behavior/policy/advanced/admin/system/**speedlimit/connlimit/ddos/dhcpdetect/domainfilter/applimit/ctcnc/porttrigger/mirror/arpdefense/wanharden/dnsaudit**）并重启对应脚本/服务；前端所有保存汇聚到 `bridge.save()`，按配置域 jobs 逐个推送（**28 个写域**，幂等安全）
- `GET ?action=run&name=ping`（只读）；`POST ?action=run&name=reboot|poweroff|reset|restartservice|ctcnc-default|ctcnc-download|arplog-clear|dnsblock-clear|login-banlist|login-unban|block-ip|unblock-ip|dnsaudit-clear`（危险操作强制 POST）
- `POST ?action=run&name=ctcnc-import`（JSON `{key, lines[]}` 上传运营商地址库）
- `POST ?action=run&name=upgrade`（原始固件二进制）→ `sysupgrade -T` 预检返回 MD5 → `upgrade-confirm` 二次确认升级
- `POST ?action=run&name=backup` → tar.gz 全量备份（base64）→ `restore`（POST body）白名单校验后还原
- **安全契约（v6）**：token 一律走请求头 `X-Golden-Token`（不进 URL/body，防日志与 Referer 泄露）；会话绑定来源 IP；危险操作全部强制 POST（CSRF 防护）；登录失败达阈值 → 应用层锁定 + iptables recent 封禁双保险，`login-banlist`/`login-unban` 查询与解封

> **真实数据全量架构（批8）**：登录后前端 `adoptRealData()` 一次拉取 `all` 接口，把后端真实配置（广域网/局域网/DHCP/QoS/负载均衡/带宽叠加/DDNS/速度限制/带宽保证/连接限制/DDOS/私接DHCP/域名过滤/应用限制/电信网通/端口触发/镜像/ARP防御/访问控制/静态路由/域名重定向/MAC设置/防火墙/行为/IP段限制/路由名称/系统时间）逐域回填 mock；WAN 以真实接口 id（`wan`/`wan2`/`wan3`…）标记并裁剪演示模式多余线路；保存时 `bridge.save()` 按 28 个配置域逐个推送后端真实生效。

---

## 四、安全加固（批4 新增）

从专业安全视角补齐的防御能力，全部「默认关闭、显式开启」，可在 **安全设置 → 安全加固** 一键配置：

| 能力 | 位置 | 说明 |
|---|---|---|
| **WAN 隐身** | 安全设置 → 安全加固 | 丢弃 WAN 口 ICMP echo（禁 Ping）+ 丢弃 TTL=1 包（防 traceroute），外网无法探测到路由器 |
| **端口扫描检测** | 安全设置 → 安全加固 | xt_recent 窗口内 SYN 达阈值 → 记录 `GOLDEN-SCAN` 告警并 DROP，触发次数/窗口可调 |
| **登录爆破封禁** | 安全设置 → 安全加固 | 登录失败达阈值 → 应用层锁定 + iptables recent **封禁 3600 秒**；页面可查询封禁列表、一键解封 |
| **域名拦截审计** | 行为管理 → 域名过滤 → 拦截审计日志 | dnsmasq `log-queries=extra` + 守护比对黑名单，记录「时间/客户端 IP/被拦截域名」 |
| **DNS 防投毒** | 行为管理 → 域名过滤 | `stop-dns-rebind` 阻止恶意网页用 DNS rebinding 攻击内网设备（默认开启，无副作用） |
| **UPnP 安全模式** | 端口映射 → UPnP设置 | `secure_mode=1` + 禁止映射特权端口（0-1023），防内网恶意软件向公网开放高危端口 |

**传输与操作安全（v6 契约）**：token 一律走请求头 `X-Golden-Token`（杜绝 URL/Referer 泄露）；危险操作（重启/关机/恢复出厂/升级/备份/清日志/封禁/解封等）全部强制 POST（CSRF 防护）；会话绑定来源 IP，换 IP 即作废。

---

## 五、安全事件中心与上网行为审计（批5 新增）

两块面向「安全运维」的新能力，让告警看得见、行为可追溯：

| 能力 | 位置 | 说明 |
|---|---|---|
| **安全事件中心** | 安全设置 → 安全事件中心 | 把 **ARP 防御 / 域名拦截 / 私接 DHCP / 端口扫描 / DDoS 攻击 / 连接超限 / 登录爆破** 七类告警聚合为统一时间线（时间/类型/级别/来源/描述），支持按类型筛选；每条事件可**一键封禁来源 IP**（iptables `golden_block` 链 DROP 全部流量，UCI 持久化，重启不丢），封禁列表可查可解封 |
| **上网行为审计** | 行为管理 → 上网行为审计 | 记录内网**每台设备的全部 DNS 查询历史**（时间/设备 IP/域名），支持按设备筛选、刷新、清空；默认关闭（日志量大），开启后 dnsmasq 记录全量查询并由守护写入 `/tmp/golden_dnsaudit.log`（5000 行截断） |

**后端事件源**：ARP（`/tmp/golden_arplog`）、域名拦截（`/tmp/golden_dnsblock.log`）、私接 DHCP（`/tmp/golden_dhcpdetect.log`）、端口扫描（内核日志 `GOLDEN-SCAN`）、DDoS/连接超限（`ddos.sh`/`connlimit.sh` 新增的 `GOLDEN-DDOS`/`GOLDEN-CONNLIMIT` 限速 LOG 规则）、登录爆破（`/tmp/golden_lock` 失败计数）。`getSecEvents` 统一归一化为 `{time, type, typeName, level, src, desc}` 并倒序输出。

---

## 六、工程结构

```
golden-full/
├── README.md                        ← 本文件
├── docs/data-contract.md            ← 前后端统一数据契约
├── app/
│   ├── index.html                   ← 全功能界面（本地直接双击打开 = 演示模式）
│   ├── golden-kernel.js             ← 演示内核（localStorage 持久化 + 系统操作模拟）
│   └── golden-bridge.js             ← 真实模式桥接（与固件版一致，本地调试用）
├── test/smoke.js                    ← 双模式冒烟测试（jsdom 加载页面 + stub 后端，断言回填与保存推送；`node test/smoke.js` 运行）
├── server/                          ← （预留）可选 Node 演示后端
├── .github/workflows/build-openwrt.yml  ← 云编译脚本（OpenWrt v23.05.5 / x86_64，squashfs 单镜像 + ccache 编译缓存）
└── package/golden/
    ├── Makefile                     ← 包定义（版本 1.1.0；依赖 mwan3/sqm/ddns-scripts/miniupnpd/tc/kmod-ifb/kmod-sched/kmod-ipt-connlimit/iptables-mod-iprange/iptables-mod-extra/kmod-ipt-ipset/iptables-mod-ipset/kmod-ipt-recent/kmod-ipt-extra/iputils-arping/dnsmasq-full）
    └── files/
        ├── etc/uci-defaults/90-golden   ← 首次启动：密码 admin、LAN 192.168.1.1、首页跳转、批2/批3/批4/批5配置初始化
        ├── etc/golden/
        │   ├── speedlimit.sh        ← 速度限制真实执行（tc htb + ifb 双向限速，支持时间控制）
        │   ├── connlimit.sh         ← 连接限制真实执行（iptables connlimit）
        │   ├── ddos.sh              ← DDOS 防御真实执行（connlimit + sysctl 内核加固）
        │   ├── domainfilter.sh      ← 域名过滤真实执行（dnsmasq 解析污染直阻断，filter/allow 双模式 + 拦截审计 + DNS 防投毒）
        │   ├── applimit.sh          ← 应用限制真实执行（iptables multiport + iprange 内置模板，支持时间控制）
        │   ├── ctcnc.sh             ← 电信网通地址真实执行（ipset 运营商地址库 + fwmark 分流独立路由表）
        │   ├── porttrigger.sh       ← 端口触发真实执行（ipset 触发源记录 + 超时自动关闭）
        │   ├── mirror.sh            ← 镜像端口真实执行（tc mirred 镜像 WAN 流量到 LAN）
        │   ├── arpdefense.sh        ← ARP 防御真实执行（MAC 绑定 + 网关锁定 + arping + 守护告警日志）
        │   ├── wanharden.sh         ← WAN 安全加固真实执行（禁 Ping + 防 traceroute + 端口扫描检测，批4）
        │   └── dnsaudit.sh          ← DNS 审计守护（批5：全量行为审计落盘 + 黑名单命中拦截审计，双功能）
        ├── etc/init.d/golden-dhcpdetect ← 私接DHCP探测守护（logread 跟踪 + 去重落盘 + 可选 DROP）
        ├── etc/init.d/golden-fw     ← 防火墙规则聚合启动（START=98：域名/应用/地址库/触发/镜像/ARP防御/WAN加固/审计/登录封禁链/一键封禁黑名单重放）
        └── www/
            ├── golden/index.html    ← 界面（固件版，加载 kernel + bridge）
            ├── golden/golden-kernel.js  ← 演示内核（先加载）
            ├── golden/golden-bridge.js  ← 真实模式桥接（探测到后端自动接管，批8 全量回填 + 28 域推送）
            └── cgi-bin/golden-api   ← 全功能后端（纯 Lua，2957 行；读写 UCI/服务/防火墙/日志/备份/升级/安全事件聚合/一键封禁；`all` 接口一次返回 30+ 配置域）
```

---

## 七、怎么进固件（会编译的老朋友直接照旧）

1. 到 https://github.com/new 新建仓库（或继续用你的 `golden-router` 仓库）
2. 上传 **golden-full 整个文件夹的内容**（含隐藏的 `.github`）
3. Actions → 黄金定制 软路由云编译 → Run workflow
4. 编译完下载固件 → Rufus 写 U 盘 → 开机 → `http://192.168.1.1`（自动进入黄金定制后台）
5. **首次登录：用户名 `root` 密码 `admin`，系统强制要求修改默认密码**；guest 账户（只读访客）默认密码 `guest`
6. 登录后界面右上角显示当前用户 = 真实模式已生效；**所有页面进入即显示真实 UCI 数据**，配置保存即写入并重启对应服务

**固件形态（2026-08-30 决策）**
- **单镜像 squashfs**：根文件系统只读 + overlay 可写（防篡改、恢复出厂秒级），不带 ext4 数据分区
- **保留 LuCI**：双后台共存（`192.168.1.1` 黄金定制 / `192.168.1.1/cgi-bin/luci` LuCI），LuCI 留作保底救急排查
- 内核/USB 支持：x86_64 传统 BIOS + EFI，含 USB2/USB3 驱动（U 盘启动/写盘均可用）

**编译时间（ccache 缓存）**
- **首次编译 2–4 小时**（需编译全部依赖，正常现象）
- **后续 20–40 分钟**：工作流缓存 `openwrt/dl`（源码包）+ `openwrt/.ccache`（编译器缓存），同一仓库重跑自动命中；改 `.config` 或上游版本变化时部分缓存失效属正常

> 想保留旧版路由配置时：系统控制 → 保存参数（下载 **tar.gz 全量备份**）→ 刷完新固件再恢复参数。

---

## 八、固件升级与参数备份（安全链路）

**固件升级（高级管理 → 固件升级）**
1. 选择固件上传（大小校验 1MB–64MB）→ 后端写入 `/tmp/golden-fw.bin` → 立即执行 `sysupgrade -T` 完整性预检，失败即取消并显示原因
2. 预检通过 → 返回固件**大小 + MD5**，前端弹窗展示 → 必须手动输入 `yes` 二次确认
3. 确认后 `nohup sysupgrade` 执行（**默认保留配置升级**，OpenWrt 自动保留 `/etc/config` 与软件包）

**参数备份 / 恢复（高级管理 → 系统控制）**
- 保存参数：后端 `tar czf` 打包 `/etc/config` + `/etc/golden` → base64 编码传输 → 前端下载 `.tar.gz`
- 恢复参数：上传 tar.gz（≤32MB）→ 后端 `tar tzf` **白名单校验**清单（拒绝绝对路径 `/` 与 `../` 穿越，仅允许 `etc/config`、`etc/golden`）→ **恢复前自动备份当前配置**（`/tmp/golden-pre-restore-*.tar.gz`）→ 解压还原并 reload network/dnsmasq/firewall

> 安全要点：备份用 base64 传输杜绝 shell 注入；升级/恢复均带「预检 + 二次确认」双保险；恢复过程中任一环节失败即中止，不触碰现有配置。

---

## 九、常见问题

**Q：本地打开 index.html 后没有"演示模式"徽标？**
A：等 1 秒自动出现；如果用的浏览器禁用了 localStorage（如隐私模式），徽标不显示但功能照常。

**Q：如何安全地远程管理路由器？**
A：高级管理 → 访问设置 → WEB 访问设置：勾选「允许从外网远程管理」后，填写**远程访问白名单**（仅允许这些外网 IP 访问，支持网段，留空 = 禁止所有外网访问）。远程访问**强制 HTTPS**（自签证书，浏览器首次会有安全提示属正常现象），默认关闭、绝不开放明文 HTTP 到 WAN。强烈建议同时关闭 SSH 远程访问，或只开放密钥登录。

**Q：忘记登录密码怎么办？**
A：用 SSH/串口登进路由器，执行 `passwd root` 重置；或 `uci set system.@system[0].golden_first_login='1' && uci commit system` 恢复"首次登录强制改密"提示。

**Q：真实模式下保存后，怎么确认写进系统了？**
A：改广域网 IP → 保存 → `ip addr show wan1` 生效；改负载均衡 → `mwan3 status` 生效；改 ARP 绑定 → `cat /etc/ethers` 生效；改 WEB 端口 → `uci get uhttpd.main.listen_http` 生效；改 SSH 端口/密钥 → `uci get dropbear.@dropbear[0].Port` 或 `cat /etc/dropbear/authorized_keys` 生效；改管理员密码 → SSH 登录验证 `/etc/shadow` 变化。

**Q：登录后页面显示的是真实数据还是演示数据？**
A：**真实数据**。登录后前端一次拉取 `all` 接口（30+ 配置域）回填到所有页面：广域网/局域网/DHCP 显示真实网卡配置，DDNS/QoS/负载均衡/速度限制/带宽保证/连接限制/DDOS/域名过滤/应用限制/端口触发/镜像/ARP 防御/访问控制/静态路由/域名重定向/MAC 设置/防火墙/行为/IP 段限制/路由名称/系统时间全部来自 UCI；WAN 线路以真实接口 id 标记（OpenWrt 默认 `wan` 或自定义 `wan1` 均自动识别），并裁剪演示模式多余的示例线路。保存任何配置后刷新页面，看到的就是路由器当前真实状态。

**Q：不想替换整个仓库？**
A：把 `package/golden`、`app` 里的新文件覆盖到旧工程对应位置，重跑一次编译即可。
