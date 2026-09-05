#!/bin/sh
# 黄金定制 — 应用限制真实执行（iptables 端口+IP 特征匹配，阻断）
# 用户决策：内置应用模板 + 自定义（模板在 Lua 后端展开为端口集合）
# 配置：golden.apprule_<N>
#   active / desc / range / rstart / rend / ports（multiport 项，逗号分隔）/ timecontrol / timeslots
# 生效：建 golden_applimit 链挂 FORWARD，规则匹配 源IP范围 + 目标端口（+可选时间段）→ DROP

CHAIN=golden_applimit

stop() {
  iptables -D FORWARD -j $CHAIN 2>/dev/null
  iptables -F $CHAIN 2>/dev/null
  iptables -X $CHAIN 2>/dev/null
}

start() {
  stop
  local enabled
  enabled=$(uci -q get golden.applimit.enabled)
  [ "$enabled" != '1' ] && return 0
  iptables -N $CHAIN 2>/dev/null
  local n=0
  while :; do
    n=$((n + 1))
    local sec="apprule_$n"
    local active
    active=$(uci -q get golden.$sec.active)
    [ -z "$active" ] && break
    [ "$active" != '1' ] && continue
    local rstart rend ports tc slots
    rstart=$(uci -q get golden.$sec.rstart)
    rend=$(uci -q get golden.$sec.rend)
    ports=$(uci -q get golden.$sec.ports)
    tc=$(uci -q get golden.$sec.timecontrol)
    slots=$(uci -q get golden.$sec.timeslots)
    [ -z "$rstart" ] && continue
    [ -z "$ports" ] && continue
    # 源地址：单 IP 用 /32，范围用 iprange
    local src=""
    if [ "$rstart" = "$rend" ]; then
      src="--source $rstart/32"
    else
      src="-m iprange --src-range $rstart-$rend"
    fi
    # 时间控制：多时间段各建一条规则
    if [ "$tc" = '1' ] && [ -n "$slots" ]; then
      echo "$slots" | tr ',' '\n' | while IFS= read -r slot; do
        [ -z "$slot" ] && continue
        local ts
        ts=$(echo "$slot" | cut -d- -f1 | tr -d ' ')
        local te
        te=$(echo "$slot" | cut -d- -f2 | tr -d ' ')
        [ -z "$ts" ] || [ -z "$te" ] && continue
        iptables -A $CHAIN $src -p tcp -m multiport --dports "$ports" -m time --timestart "$ts" --timestop "$te" -j DROP 2>/dev/null
        iptables -A $CHAIN $src -p udp -m multiport --dports "$ports" -m time --timestart "$ts" --timestop "$te" -j DROP 2>/dev/null
      done
    else
      iptables -A $CHAIN $src -p tcp -m multiport --dports "$ports" -j DROP 2>/dev/null
      iptables -A $CHAIN $src -p udp -m multiport --dports "$ports" -j DROP 2>/dev/null
    fi
  done
  iptables -I FORWARD -j $CHAIN 2>/dev/null
}

case "$1" in
  stop) stop ;;
  start) start ;;
  restart) stop; start ;;
esac
exit 0
