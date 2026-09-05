#
# 黄金定制 软路由管理后台（界面 + 真实数据接口）
# OpenWrt 包定义
#
include $(TOPDIR)/rules.mk

PKG_NAME:=golden
PKG_VERSION:=1.1.0
PKG_RELEASE:=11

include $(INCLUDE_DIR)/package.mk

define Package/golden
  SECTION:=admin
  CATEGORY:=Administration
  TITLE:=黄金定制 软路由管理后台（完整版）
  # 依赖说明（OpenWrt v23.05.5 实际包名，2026-09-02 已验证官方仓库）：
  #   kmod-ipt-conntrack-extra：-m recent / -m connlimit（23.05 已把 kmod-ipt-recent / kmod-ipt-connlimit 并入此包）
  #   kmod-ipt-extra：-m time / -m ttl；iptables-mod-extra：-m time 用户态；iptables-mod-iprange：-m iprange
  #   注意：23.05 已移除 iptables-mod-ipset（-m set 用户态插件），ctcnc/porttrigger 脚本内含运行时探测降级
  # px5g 依赖说明：OpenWrt 23.05 中 px5g-mbedtls(动态) 与 px5g-standalone(静态) 为同一程序的两个
  # 变体，可执行文件都安装为 /usr/sbin/px5g（PROVIDES:=px5g），uhttpd.init 查找的正是该路径。
  # 因此依赖写 +px5g（默认解析到 px5g-mbedtls）即可；切勿同时手动勾选两个变体（同路径文件冲突）。
  # dropbear：SSH 保底排障通道（v1.1.1 起强制依赖，无论 .config 是否勾选都会装上）。
  #            config.buildinfo 实测上一版未勾 dropbear —— Web 若异常则完全无远程入口。
  DEPENDS:=+lua +uhttpd +dropbear +px5g +libuci-lua +mwan3 +sqm-scripts +ddns-scripts +miniupnpd +ip-full +ipset +tc +kmod-ifb +kmod-sched +kmod-ipt-conntrack-extra +iptables-mod-iprange +iptables-mod-extra +kmod-ipt-extra +kmod-ipt-ipset +kmod-ipt-core +iputils-arping +dnsmasq-full
  PKGARCH:=all
endef

define Package/golden/description
  黄金定制 软路由 Web 管理后台（完整版 v1.1.0）。
  包含：管理界面（/www/golden/，双模式：演示/真实）+ 全功能后端（/cgi-bin/golden-api）。
  覆盖 53 个功能页面：网络/多WAN负载均衡/带宽叠加/智能QoS/DDNS/防火墙/ARP绑定/安全事件中心/
  上网行为审计/策略路由等，配置真实写入 UCI 并即时生效。
  开机后访问 http://192.168.1.1/golden/ 即可使用。
  依赖说明：dnsmasq-full（上网行为审计 log-queries=extra）、iputils-arping（ARP 防御）、
  kmod-ipt-conntrack-extra（登录爆破封禁/扫描检测，-m recent/connlimit）、kmod-ipt-extra（按时间/ttl 限速）。
endef

define Build/Compile
endef

define Package/golden/install
	# 管理界面
	$(INSTALL_DIR) $(1)/www/golden
	$(INSTALL_DATA) ./files/www/golden/index.html $(1)/www/golden/index.html
	$(INSTALL_DATA) ./files/www/golden/golden-kernel.js $(1)/www/golden/golden-kernel.js
	$(INSTALL_DATA) ./files/www/golden/golden-bridge.js $(1)/www/golden/golden-bridge.js
	# 后端接口（CGI，可执行）
	$(INSTALL_DIR) $(1)/www/cgi-bin
	$(INSTALL_BIN) ./files/www/cgi-bin/golden-api $(1)/www/cgi-bin/golden-api
	# 首次启动配置
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/etc/uci-defaults/90-golden $(1)/etc/uci-defaults/90-golden
	# 速度限制 / 连接限制 / DDOS 应用脚本
	$(INSTALL_DIR) $(1)/etc/golden
	$(INSTALL_BIN) ./files/etc/golden/speedlimit.sh $(1)/etc/golden/speedlimit.sh
	$(INSTALL_BIN) ./files/etc/golden/connlimit.sh $(1)/etc/golden/connlimit.sh
	$(INSTALL_BIN) ./files/etc/golden/ddos.sh $(1)/etc/golden/ddos.sh
	# 批3 应用脚本：域名过滤 / 应用限制 / 端口触发 / 镜像 / 电信网通 / ARP 防御
	$(INSTALL_BIN) ./files/etc/golden/domainfilter.sh $(1)/etc/golden/domainfilter.sh
	$(INSTALL_BIN) ./files/etc/golden/applimit.sh $(1)/etc/golden/applimit.sh
	$(INSTALL_BIN) ./files/etc/golden/porttrigger.sh $(1)/etc/golden/porttrigger.sh
	$(INSTALL_BIN) ./files/etc/golden/mirror.sh $(1)/etc/golden/mirror.sh
	$(INSTALL_BIN) ./files/etc/golden/ctcnc.sh $(1)/etc/golden/ctcnc.sh
	$(INSTALL_BIN) ./files/etc/golden/arpdefense.sh $(1)/etc/golden/arpdefense.sh
	# 批4 广域网安全加固
	$(INSTALL_BIN) ./files/etc/golden/wanharden.sh $(1)/etc/golden/wanharden.sh
	# 批5 DNS 行为审计 + 域名拦截审计（双功能守护）
	$(INSTALL_BIN) ./files/etc/golden/dnsaudit.sh $(1)/etc/golden/dnsaudit.sh
	# 私接 DHCP 探测守护 + 批3 规则聚合启动
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/golden-dhcpdetect $(1)/etc/init.d/golden-dhcpdetect
	$(INSTALL_BIN) ./files/etc/init.d/golden-fw $(1)/etc/init.d/golden-fw
endef

$(eval $(call BuildPackage,golden))
