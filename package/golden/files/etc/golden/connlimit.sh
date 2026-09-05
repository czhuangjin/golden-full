#!/bin/sh
# ============================================================
# 黄金定制 — 连接限制（按 IP 规则限制并发连接数）
# 实现: iptables connlimit（filter 表 FORWARD 链）
# 用法: /etc/golden/connlimit.sh {start|stop|restart}
# 配置: UCI golden.connlimit.default_limit=0|N（规则之外主机的默认上限）
#       golden.connrule_<n> 段:
#         active=1|0 desc range(rstart/rend) limit
#         timecontrol=1|0 timeslots=HH:MM-HH:MM[,HH:MM-HH:MM]
# 说明: 时间控制由 iptables -m time 内核自动切换。
# ============================================================

IPT=/usr/sbin/iptables

log() { logger -t golden-connlimit "$@"; }

time_slots() {
  local ts="$1"
  local IFS=","
  for slot in $ts; do
    local a=${slot%%-*} b=${slot##*-}
    [ -n "$a" ] && [ -n "$b" ] && echo "$a $b"
  done
}

stop_all() {
  $IPT -D FORWARD -j golden_connlimit 2>/dev/null
  $IPT -F golden_connlimit 2>/dev/null
  $IPT -X golden_connlimit 2>/dev/null
}

start() {
  stop_all
  modprobe xt_connlimit 2>/dev/null
  modprobe xt_time 2>/dev/null
  modprobe xt_limit 2>/dev/null

  $IPT -N golden_connlimit 2>/dev/null

  local secs
  secs=$(uci -q show golden 2>/dev/null | sed -n 's/^golden\.\(connrule_[0-9][0-9]*\)\..*/\1/p' | sort -u)
  local sec
  for sec in $secs; do
    local active
    active=$(uci -q get golden.$sec.active)
    [ "$active" = "1" ] || continue

    local rs re limit timecontrol ts
    rs=$(uci -q get golden.$sec.rstart)
    re=$(uci -q get golden.$sec.rend)
    limit=$(uci -q get golden.$sec.limit)
    [ -n "$rs" ] || continue
    [ "$limit" -gt 0 ] 2>/dev/null || continue

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
        # 超限告警（限速 LOG，供安全事件中心聚合）
        $IPT -A golden_connlimit -p tcp -m time --kerneltz --timestart "$a" --timestop "$b" -m iprange --src-range "$rs-$re" -m connlimit --connlimit-above "$limit" --connlimit-mask 32 -m limit --limit 5/min -j LOG --log-prefix "GOLDEN-CONNLIMIT " --log-level 4 2>/dev/null
        # TCP：重置超限连接；其他协议：丢弃
        $IPT -A golden_connlimit -p tcp -m time --kerneltz --timestart "$a" --timestop "$b" -m iprange --src-range "$rs-$re" -m connlimit --connlimit-above "$limit" --connlimit-mask 32 -j REJECT --reject-with tcp-reset 2>/dev/null
        $IPT -A golden_connlimit -m time --kerneltz --timestart "$a" --timestop "$b" -m iprange --src-range "$rs-$re" -m connlimit --connlimit-above "$limit" --connlimit-mask 32 -m limit --limit 5/min -j LOG --log-prefix "GOLDEN-CONNLIMIT " --log-level 4 2>/dev/null
        $IPT -A golden_connlimit -m time --kerneltz --timestart "$a" --timestop "$b" -m iprange --src-range "$rs-$re" -m connlimit --connlimit-above "$limit" --connlimit-mask 32 -j DROP 2>/dev/null
      done <<EOF
$targs
EOF
    else
      $IPT -A golden_connlimit -p tcp -m iprange --src-range "$rs-$re" -m connlimit --connlimit-above "$limit" --connlimit-mask 32 -m limit --limit 5/min -j LOG --log-prefix "GOLDEN-CONNLIMIT " --log-level 4 2>/dev/null
      $IPT -A golden_connlimit -p tcp -m iprange --src-range "$rs-$re" -m connlimit --connlimit-above "$limit" --connlimit-mask 32 -j REJECT --reject-with tcp-reset 2>/dev/null
      $IPT -A golden_connlimit -m iprange --src-range "$rs-$re" -m connlimit --connlimit-above "$limit" --connlimit-mask 32 -m limit --limit 5/min -j LOG --log-prefix "GOLDEN-CONNLIMIT " --log-level 4 2>/dev/null
      $IPT -A golden_connlimit -m iprange --src-range "$rs-$re" -m connlimit --connlimit-above "$limit" --connlimit-mask 32 -j DROP 2>/dev/null
    fi
  done

  # 默认主机连接数限制（规则之外的所有主机）
  local def
  def=$(uci -q get golden.connlimit.default_limit)
  [ "$def" -gt 0 ] 2>/dev/null && {
    $IPT -A golden_connlimit -p tcp -m connlimit --connlimit-above "$def" --connlimit-mask 32 -m limit --limit 5/min -j LOG --log-prefix "GOLDEN-CONNLIMIT " --log-level 4 2>/dev/null
    $IPT -A golden_connlimit -p tcp -m connlimit --connlimit-above "$def" --connlimit-mask 32 -j REJECT --reject-with tcp-reset 2>/dev/null
    $IPT -A golden_connlimit -m connlimit --connlimit-above "$def" --connlimit-mask 32 -m limit --limit 5/min -j LOG --log-prefix "GOLDEN-CONNLIMIT " --log-level 4 2>/dev/null
    $IPT -A golden_connlimit -m connlimit --connlimit-above "$def" --connlimit-mask 32 -j DROP 2>/dev/null
  }

  $IPT -I FORWARD -j golden_connlimit 2>/dev/null
  log "connlimit applied"
}

stop() { stop_all; log "connlimit stopped"; }

case "$1" in
  start) start ;;
  stop) stop ;;
  restart) start ;;
  *) echo "usage: $0 {start|stop|restart}" >&2; exit 1 ;;
esac
