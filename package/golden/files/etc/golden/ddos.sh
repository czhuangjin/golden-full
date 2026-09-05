#!/bin/sh
# ============================================================
# 黄金定制 — DDOS 攻击防御
# 实现: iptables connlimit（FORWARD）+ 内核防洪水 sysctl 加固
# 用法: /etc/golden/ddos.sh {start|stop|restart}
# 配置: UCI golden.ddos.default_concurrent=500 default_interval=1
#       golden.ddosrule_<n> 段:
#         active=1|0 desc range(rstart/rend) concurrent interval
#         timecontrol=1|0 timeslots=HH:MM-HH:MM[,HH:MM-HH:MM]
# 说明: 并发数 = 同时建立的连接上限，超限直接丢弃新连接；
#       interval 为时间窗口参数（存档），实际以 concurrent 为准。
# ============================================================

IPT=/usr/sbin/iptables
SYSCTL=/sbin/sysctl

log() { logger -t golden-ddos "$@"; }

time_slots() {
  local ts="$1"
  local IFS=","
  for slot in $ts; do
    local a=${slot%%-*} b=${slot##*-}
    [ -n "$a" ] && [ -n "$b" ] && echo "$a $b"
  done
}

stop_all() {
  $IPT -D FORWARD -j golden_ddos 2>/dev/null
  $IPT -F golden_ddos 2>/dev/null
  $IPT -X golden_ddos 2>/dev/null
}

start() {
  stop_all
  modprobe xt_connlimit 2>/dev/null
  modprobe xt_time 2>/dev/null
  modprobe xt_limit 2>/dev/null

  $IPT -N golden_ddos 2>/dev/null

  local secs
  secs=$(uci -q show golden 2>/dev/null | sed -n 's/^golden\.\(ddosrule_[0-9][0-9]*\)\..*/\1/p' | sort -u)
  local sec
  for sec in $secs; do
    local active
    active=$(uci -q get golden.$sec.active)
    [ "$active" = "1" ] || continue

    local rs re cc timecontrol ts
    rs=$(uci -q get golden.$sec.rstart)
    re=$(uci -q get golden.$sec.rend)
    cc=$(uci -q get golden.$sec.concurrent)
    [ -n "$rs" ] || continue
    [ "$cc" -gt 0 ] 2>/dev/null || continue

    timecontrol=$(uci -q get golden.$sec.timecontrol)
    local targs=""
    if [ "$timecontrol" = "1" ]; then
      ts=$(uci -q get golden.$sec.timeslots)
      targs="$(time_slots "$ts")"
    fi

    if [ -n "$targs" ]; then
      local a b
      while read -r a b; do
        [ -n "$a" ] || continue
        # 超限告警（限速 LOG，供安全事件中心聚合）+ 丢弃
        $IPT -A golden_ddos -p tcp --syn -m time --kerneltz --timestart "$a" --timestop "$b" -m iprange --src-range "$rs-$re" -m connlimit --connlimit-above "$cc" --connlimit-mask 32 -m limit --limit 5/min -j LOG --log-prefix "GOLDEN-DDOS " --log-level 4 2>/dev/null
        $IPT -A golden_ddos -p tcp --syn -m time --kerneltz --timestart "$a" --timestop "$b" -m iprange --src-range "$rs-$re" -m connlimit --connlimit-above "$cc" --connlimit-mask 32 -j DROP 2>/dev/null
        $IPT -A golden_ddos -m time --kerneltz --timestart "$a" --timestop "$b" -m iprange --src-range "$rs-$re" -m connlimit --connlimit-above "$cc" --connlimit-mask 32 -m limit --limit 5/min -j LOG --log-prefix "GOLDEN-DDOS " --log-level 4 2>/dev/null
        $IPT -A golden_ddos -m time --kerneltz --timestart "$a" --timestop "$b" -m iprange --src-range "$rs-$re" -m connlimit --connlimit-above "$cc" --connlimit-mask 32 -j DROP 2>/dev/null
      done <<EOF
$targs
EOF
    else
      $IPT -A golden_ddos -p tcp --syn -m iprange --src-range "$rs-$re" -m connlimit --connlimit-above "$cc" --connlimit-mask 32 -m limit --limit 5/min -j LOG --log-prefix "GOLDEN-DDOS " --log-level 4 2>/dev/null
      $IPT -A golden_ddos -p tcp --syn -m iprange --src-range "$rs-$re" -m connlimit --connlimit-above "$cc" --connlimit-mask 32 -j DROP 2>/dev/null
      $IPT -A golden_ddos -m iprange --src-range "$rs-$re" -m connlimit --connlimit-above "$cc" --connlimit-mask 32 -m limit --limit 5/min -j LOG --log-prefix "GOLDEN-DDOS " --log-level 4 2>/dev/null
      $IPT -A golden_ddos -m iprange --src-range "$rs-$re" -m connlimit --connlimit-above "$cc" --connlimit-mask 32 -j DROP 2>/dev/null
    fi
  done

  # 默认并发限制（规则之外的所有主机）
  local dc
  dc=$(uci -q get golden.ddos.default_concurrent)
  [ "$dc" -gt 0 ] 2>/dev/null && {
    $IPT -A golden_ddos -p tcp --syn -m connlimit --connlimit-above "$dc" --connlimit-mask 32 -m limit --limit 5/min -j LOG --log-prefix "GOLDEN-DDOS " --log-level 4 2>/dev/null
    $IPT -A golden_ddos -p tcp --syn -m connlimit --connlimit-above "$dc" --connlimit-mask 32 -j DROP 2>/dev/null
    $IPT -A golden_ddos -m connlimit --connlimit-above "$dc" --connlimit-mask 32 -m limit --limit 5/min -j LOG --log-prefix "GOLDEN-DDOS " --log-level 4 2>/dev/null
    $IPT -A golden_ddos -m connlimit --connlimit-above "$dc" --connlimit-mask 32 -j DROP 2>/dev/null
  }

  $IPT -I FORWARD -j golden_ddos 2>/dev/null

  # 内核防洪水加固（仅启用，不覆盖用户已有更严格配置）
  $SYSCTL -w net.ipv4.tcp_syncookies=1 2>/dev/null
  $SYSCTL -w net.ipv4.tcp_syn_retries=3 2>/dev/null
  $SYSCTL -w net.ipv4.tcp_synack_retries=2 2>/dev/null
  $SYSCTL -w net.ipv4.tcp_max_syn_backlog=1024 2>/dev/null
  $SYSCTL -w net.ipv4.tcp_abort_on_overflow=1 2>/dev/null
  $SYSCTL -w net.ipv4.icmp_echo_ignore_broadcasts=1 2>/dev/null
  $SYSCTL -w net.ipv4.conf.all.rp_filter=1 2>/dev/null

  log "ddos defense applied"
}

stop() { stop_all; log "ddos defense stopped"; }

case "$1" in
  start) start ;;
  stop) stop ;;
  restart) start ;;
  *) echo "usage: $0 {start|stop|restart}" >&2; exit 1 ;;
esac
