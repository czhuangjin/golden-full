#!/bin/sh
# 黄金定制 — 镜像端口真实执行（tc mirred 端口镜像）
# 把全部 WAN 物理口的流量镜像到目标接口（默认 br-lan，监控主机可抓包）
# 配置：golden.mirror（enabled=1/0、dir=in/out/all、mode=host/port、ip=目标）
#   mode=host → 镜像到 br-lan（ip 为监控主机 IP，作提示）
#   mode=port → 镜像到 ip 指定的接口名（如 eth1 / br-lan）
# 注意：源接口不得等于目标接口（会环路）；目标接口需存在

stop() {
  local dev
  for dev in $(uci -q get network.wan.ifname) $(uci -q get network.wan2.ifname) $(uci -q get network.wan3.ifname); do
    [ -z "$dev" ] && continue
    tc qdisc del dev "$dev" ingress 2>/dev/null
    tc qdisc del dev "$dev" root 2>/dev/null
  done
}

start() {
  stop
  local enabled
  enabled=$(uci -q get golden.mirror.enabled)
  [ "$enabled" != '1' ] && return 0
  local dir mode ip
  dir=$(uci -q get golden.mirror.dir)
  mode=$(uci -q get golden.mirror.mode)
  ip=$(uci -q get golden.mirror.ip)
  [ -z "$dir" ] && dir='all'
  [ -z "$mode" ] && mode='host'
  local target='br-lan'
  if [ "$mode" = 'port' ] && [ -n "$ip" ]; then
    target="$ip"
  fi
  [ -z "$ip" ] && [ "$mode" = 'host' ] && ip='0.0.0.0'
  # 目标接口必须存在
  ip link show "$target" >/dev/null 2>&1 || return 0
  local dev
  for dev in $(uci -q get network.wan.ifname) $(uci -q get network.wan2.ifname) $(uci -q get network.wan3.ifname); do
    [ -z "$dev" ] && continue
    [ "$dev" = "$target" ] && continue   # 防止镜像环路
    ip link show "$dev" >/dev/null 2>&1 || continue
    # 入站镜像（WAN ← 外部）
    if [ "$dir" = 'in' ] || [ "$dir" = 'all' ]; then
      tc qdisc add dev "$dev" handle ffff: ingress 2>/dev/null
      tc filter add dev "$dev" parent ffff: protocol all u32 match u8 0 0 action mirred egress mirror dev "$target" 2>/dev/null
    fi
    # 出站镜像（WAN → 外部）
    if [ "$dir" = 'out' ] || [ "$dir" = 'all' ]; then
      tc qdisc add dev "$dev" root handle 1: prio 2>/dev/null
      tc filter add dev "$dev" parent 1: protocol all u32 match u8 0 0 action mirred egress mirror dev "$target" 2>/dev/null
    fi
  done
}

case "$1" in
  stop) stop ;;
  start) start ;;
  restart) stop; start ;;
esac
exit 0
