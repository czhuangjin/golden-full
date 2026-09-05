#!/bin/sh
# 黄金定制 — 电信网通地址库真实执行（ipset 集合 + ip rule 自动分流）
# 地址库：电信(ct) / 网通(cnc) / 铁通(tietong) / 教育网(edu) / 自定义1-3(custom1-3)
# 配置：golden.ctcnc_<key>.enabled（1/0）；网段文件 /etc/golden/iplib/<key>.txt（每行 CIDR）
# 分流规则（仅对启用且文件存在的库）：
#   电信→广域网1、网通→广域网2、铁通→广域网3（走 mangle MARK + 独立路由表）
#   教育网/自定义库：仅建 ipset 集合，不自动分流（可配合策略路由使用）
# MARK 段 0x201-0x203，路由表 101-103（与批2 限速 mark 10+N/100+N 不冲突）

IPLIB=/etc/golden/iplib
CHAIN=golden_ctcnc

stop() {
  iptables -t mangle -D PREROUTING -j $CHAIN 2>/dev/null
  iptables -t mangle -F $CHAIN 2>/dev/null
  iptables -t mangle -X $CHAIN 2>/dev/null
  local tbl
  for tbl in 101 102 103; do
    ip route flush table $tbl 2>/dev/null
    ip rule del pref 2000 table $tbl 2>/dev/null
  done
  local lib
  for lib in ct cnc tietong edu custom1 custom2 custom3; do
    ipset destroy golden_$lib 2>/dev/null
  done
}

# 填充 ipset 集合
fill_set() {
  local key="$1"
  local f="$IPLIB/$key.txt"
  [ -f "$f" ] || return 0
  local cidr
  while IFS= read -r cidr; do
    [ -z "$cidr" ] && continue
    case "$cidr" in
      *.*.*.*/*) ipset add golden_$key "$cidr" 2>/dev/null ;;
    esac
  done < "$f"
}

# 建立分流：mark + 路由表 + 网关
setup_route() {
  local key="$1" mark="$2" tbl="$3" widx="$4"
  local ifname gw
  # 广域网1 → network.wan，其余 → network.wan<N>
  if [ "$widx" = "1" ]; then
    ifname=$(uci -q get network.wan.ifname)
    gw=$(uci -q get network.wan.gateway)
  else
    ifname=$(uci -q get network.wan$widx.ifname)
    gw=$(uci -q get network.wan$widx.gateway)
  fi
  [ -z "$ifname" ] && return 0
  [ -z "$gw" ] && return 0
  # 集合内目标地址 → 打 mark
  iptables -t mangle -A $CHAIN -m set --match-set golden_$key dst -j MARK --set-mark $mark 2>/dev/null
  # 路由表：mark → 对应线路
  ip route flush table $tbl 2>/dev/null
  ip route add default via "$gw" dev "$ifname" table $tbl 2>/dev/null
  ip rule add pref 2000 fwmark $mark table $tbl 2>/dev/null
}

start() {
  stop
  local any=0
  local key
  for key in ct cnc tietong edu custom1 custom2 custom3; do
    local enabled
    enabled=$(uci -q get golden.ctcnc_$key.enabled)
    [ "$enabled" = '1' ] && any=1
  done
  [ "$any" = '0' ] && return 0
  # OpenWrt 23.05 官方已移除 iptables-mod-ipset（-m set 组件），
  # 探测后降级：不建分流规则、明确写日志，避免功能静默失效
  if ! iptables -m set -h >/dev/null 2>&1; then
    logger -t golden-ctcnc "固件缺少 iptables -m set 组件（23.05 已移除 iptables-mod-ipset），电信网通分流不可用"
    return 0
  fi
  iptables -t mangle -N $CHAIN 2>/dev/null
  # 先建所有启用库的 ipset 并填充
  for key in ct cnc tietong edu custom1 custom2 custom3; do
    local enabled
    enabled=$(uci -q get golden.ctcnc_$key.enabled)
    [ "$enabled" != '1' ] && continue
    ipset create golden_$key hash:net -exist 2>/dev/null
    fill_set "$key"
  done
  # 自动分流：电信→WAN1、网通→WAN2、铁通→WAN3
  setup_route ct 0x201 101 1
  setup_route cnc 0x202 102 2
  setup_route tietong 0x203 103 3
  # 挂入 PREROUTING
  iptables -t mangle -I PREROUTING -j $CHAIN 2>/dev/null
}

case "$1" in
  stop) stop ;;
  start) start ;;
  restart) stop; start ;;
esac
exit 0
