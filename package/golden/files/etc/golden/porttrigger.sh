#!/bin/sh
# 黄金定制 — 端口触发真实执行（ipset 记录触发主机 + 放行映射端口入站）
# 原理：内网主机访问「触发端口」时，其源 IP 被记入 ipset（timeout 600s）；
#       随后任意外部主机可访问该内网主机的「映射端口」（几分钟不触发自动关闭，符合原版提示）
# 配置：golden.porttrigger_<N>（active / desc / proto / trigger / map）
#   proto: tcp / udp / tcp+udp；trigger/map: 端口或范围（如 3724 / 3724-4000）

CHAIN=golden_trigger
CHAIN_IN=golden_trigger_in

stop() {
  iptables -t mangle -D PREROUTING -j $CHAIN 2>/dev/null
  iptables -t mangle -F $CHAIN 2>/dev/null
  iptables -t mangle -X $CHAIN 2>/dev/null
  iptables -D FORWARD -j $CHAIN_IN 2>/dev/null
  iptables -F $CHAIN_IN 2>/dev/null
  iptables -X $CHAIN_IN 2>/dev/null
  local s
  for s in $(ipset list -name 2>/dev/null | grep '^golden_trig[0-9]'); do
    ipset destroy "$s" 2>/dev/null
  done
}

start() {
  stop
  local enabled
  enabled=$(uci -q get golden.porttrigger.enabled)
  [ "$enabled" != '1' ] && return 0
  # OpenWrt 23.05 官方已移除 iptables-mod-ipset（-m set / -j SET 组件），
  # 探测后降级：不建规则、明确写日志，避免功能静默失效
  if ! iptables -m set -h >/dev/null 2>&1; then
    logger -t golden-porttrigger "固件缺少 iptables -m set 组件（23.05 已移除 iptables-mod-ipset），端口触发功能不可用"
    return 0
  fi
  iptables -t mangle -N $CHAIN 2>/dev/null
  iptables -N $CHAIN_IN 2>/dev/null
  local n=0
  while :; do
    n=$((n + 1))
    local sec="porttrigger_$n"
    local active
    active=$(uci -q get golden.$sec.active)
    [ -z "$active" ] && break
    [ "$active" != '1' ] && continue
    local proto trigger map
    proto=$(uci -q get golden.$sec.proto)
    trigger=$(uci -q get golden.$sec.trigger)
    map=$(uci -q get golden.$sec.map)
    [ -z "$trigger" ] && continue
    [ -z "$map" ] && continue
    proto=$(echo "$proto" | tr 'A-Z' 'a-z')
    case "$proto" in
      tcp+udp|udp+tcp) proto='tcp+udp' ;;
      udp) proto='udp' ;;
      *) proto='tcp' ;;
    esac
    local set="golden_trig$n"
    ipset create "$set" hash:ip timeout 600 -exist 2>/dev/null
    # 触发：内网访问触发端口 → 记录源 IP
    # 放行：外部访问该主机映射端口 → 目的 IP 在集合中则放行
    case "$proto" in
      tcp+udp)
        iptables -t mangle -A $CHAIN -p tcp --dport "$trigger" -j SET --add-set "$set" src 2>/dev/null
        iptables -t mangle -A $CHAIN -p udp --dport "$trigger" -j SET --add-set "$set" src 2>/dev/null
        iptables -A $CHAIN_IN -p tcp -m set --match-set "$set" dst -m multiport --dports "$map" -j ACCEPT 2>/dev/null
        iptables -A $CHAIN_IN -p udp -m set --match-set "$set" dst -m multiport --dports "$map" -j ACCEPT 2>/dev/null
        ;;
      udp)
        iptables -t mangle -A $CHAIN -p udp --dport "$trigger" -j SET --add-set "$set" src 2>/dev/null
        iptables -A $CHAIN_IN -p udp -m set --match-set "$set" dst -m multiport --dports "$map" -j ACCEPT 2>/dev/null
        ;;
      *)
        iptables -t mangle -A $CHAIN -p tcp --dport "$trigger" -j SET --add-set "$set" src 2>/dev/null
        iptables -A $CHAIN_IN -p tcp -m set --match-set "$set" dst -m multiport --dports "$map" -j ACCEPT 2>/dev/null
        ;;
    esac
  done
  iptables -t mangle -A PREROUTING -j $CHAIN 2>/dev/null
  iptables -I FORWARD -j $CHAIN_IN 2>/dev/null
}

case "$1" in
  stop) stop ;;
  start) start ;;
  restart) stop; start ;;
esac
exit 0
