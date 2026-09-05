#!/bin/sh
# ============================================================
# 黄金定制 — WAN 隐身 + 端口扫描检测
# 实现:
#   1. WAN 禁 Ping：input_wan 丢弃 icmp echo-request（外网探测不到）
#   2. 防 traceroute：丢弃 TTL=1 包
#   3. 端口扫描检测：xt_recent 记录 SYN，N 秒内超过阈值 → LOG + DROP
# 用法: /etc/golden/wanharden.sh {start|stop|restart}
# 配置: UCI golden.wanharden.<opt>
#         ping_wan=1|0        WAN 禁 Ping
#         ttl_drop=1|0        防 traceroute（TTL=1 丢弃）
#         scan_enable=1|0     端口扫描检测
#         scan_hitcount=30    窗口内 SYN 次数阈值
#         scan_seconds=60     检测时间窗口（秒）
# 日志: 内核日志 LOG 前缀 "GOLDEN-SCAN"（logread 可查，供安全事件中心聚合）
# ============================================================

IPT=/usr/sbin/iptables

log() { logger -t golden-wanharden "$@"; }

stop_all() {
  $IPT -D input_wan -j golden_wanharden 2>/dev/null
  $IPT -D input_wan -p icmp --icmp-type echo-request -j DROP 2>/dev/null
  $IPT -D input_wan -m ttl --ttl-eq 1 -j DROP 2>/dev/null
  $IPT -F golden_wanharden 2>/dev/null
  $IPT -X golden_wanharden 2>/dev/null
}

start() {
  stop_all
  modprobe xt_recent 2>/dev/null
  modprobe xt_ttl 2>/dev/null
  modprobe xt_limit 2>/dev/null

  local ping_wan ttl_drop scan_enable scan_hit scan_sec
  ping_wan=$(uci -q get golden.wanharden.ping_wan)
  ttl_drop=$(uci -q get golden.wanharden.ttl_drop)
  scan_enable=$(uci -q get golden.wanharden.scan_enable)
  scan_hit=$(uci -q get golden.wanharden.scan_hitcount)
  scan_sec=$(uci -q get golden.wanharden.scan_seconds)
  [ -z "$scan_hit" ] && scan_hit=30
  [ -z "$scan_sec" ] && scan_sec=60
  [ "$scan_hit" -gt 0 ] 2>/dev/null || scan_hit=30
  [ "$scan_sec" -gt 0 ] 2>/dev/null || scan_sec=60

  # WAN 禁 Ping（仅影响外网方向，内网不受影响）
  if [ "$ping_wan" = "1" ]; then
    $IPT -A input_wan -p icmp --icmp-type echo-request -j DROP 2>/dev/null
  fi

  # 防 traceroute：TTL=1 包丢弃
  if [ "$ttl_drop" = "1" ]; then
    $IPT -A input_wan -m ttl --ttl-eq 1 -j DROP 2>/dev/null
  fi

  # 端口扫描检测：scan_sec 秒内 SYN 命中 scan_hit 次 → 记录并 DROP
  if [ "$scan_enable" = "1" ]; then
    $IPT -N golden_wanharden 2>/dev/null
    $IPT -F golden_wanharden 2>/dev/null
    $IPT -A golden_wanharden -p tcp --syn -m recent --name portscan --rcheck --seconds "$scan_sec" --hitcount "$scan_hit" -m limit --limit 5/min -j LOG --log-prefix "GOLDEN-SCAN " --log-level 4 2>/dev/null
    $IPT -A golden_wanharden -p tcp --syn -m recent --name portscan --rcheck --seconds "$scan_sec" --hitcount "$scan_hit" -j DROP 2>/dev/null
    $IPT -A golden_wanharden -p tcp --syn -m recent --name portscan --set -j RETURN 2>/dev/null
    $IPT -A input_wan -j golden_wanharden 2>/dev/null
    log "port scan detection enabled (${scan_hit} syn / ${scan_sec}s)"
  fi

  log "wan harden applied"
}

stop() { stop_all; log "wan harden stopped"; }

case "$1" in
  start) start ;;
  stop) stop ;;
  restart) start ;;
  *) echo "usage: $0 {start|stop|restart}" >&2; exit 1 ;;
esac
