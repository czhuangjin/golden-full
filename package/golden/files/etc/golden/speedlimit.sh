#!/bin/sh
# ============================================================
# 黄金定制 — 速度限制（按 IP 规则限速）
# 实现: tc htb（wan 出方向=上行）+ ifb 镜像（wan 入方向=下行）
# 分类: iptables mangle 打 MARK + tc fw classifier
# 用法: /etc/golden/speedlimit.sh {start|stop|restart}
# 配置: UCI golden.speedrule_<n> 段（由 golden-api 写入）:
#   active=1|0   desc        说明
#   mode=share|single        共享限制 / 单独限制（逐 IP 独立限速）
#   dev=eth0.2               WAN 设备名
#   up=Kbps  down=Kbps       0 表示不限
#   rstart/rend              主机范围（share 模式，起止 IP）
#   ips=ip1,ip2,...          主机列表（single 模式）
#   timecontrol=1|0 timeslots=HH:MM-HH:MM[,HH:MM-HH:MM]
# 说明: 时间控制由 iptables -m time 内核自动切换，无需 cron；
#       速度限制与 SQM 智能 QoS 同接口冲突，勿同时启用。
# ============================================================

TC=/usr/sbin/tc
IPT=/usr/sbin/iptables
IP=/sbin/ip

log() { logger -t golden-speed "$@"; }

stop_all() {
  $IPT -t mangle -F golden_speed 2>/dev/null
  $IPT -t mangle -D PREROUTING -j golden_speed 2>/dev/null
  $IPT -t mangle -D POSTROUTING -j golden_speed 2>/dev/null
  $IPT -t mangle -X golden_speed 2>/dev/null
  # 清理所有 ifb_s* 镜像设备
  for d in /sys/class/net/ifb_s*; do
    [ -e "$d" ] || continue
    dev=${d##*/}
    $IP link set "$dev" down 2>/dev/null
    $TC qdisc del dev "$dev" root 2>/dev/null
    $IP link del "$dev" 2>/dev/null
  done
  # 清理 WAN 设备上残留的 tc（root + ingress）
  for d in $(uci -q show network 2>/dev/null | sed -n 's/^network\.\(wan[a-z0-9]*\)\.ifname=//p'); do
    for ifn in $d; do
      $TC qdisc del dev "$ifn" root 2>/dev/null
      $TC qdisc del dev "$ifn" ingress 2>/dev/null
    done
  done
}

# 生成 iptables -m time 参数（多时间段用多条规则分别打标）
# 输出: 每段一行 "start end"，供调用方逐段建规则
time_slots() {
  local ts="$1"
  local IFS=","
  for slot in $ts; do
    local a=${slot%%-*} b=${slot##*-}
    [ -n "$a" ] && [ -n "$b" ] && echo "$a $b"
  done
}

start() {
  stop_all
  modprobe ifb 2>/dev/null

  local secs
  secs=$(uci -q show golden 2>/dev/null | sed -n 's/^golden\.\(speedrule_[0-9][0-9]*\)\..*/\1/p' | sort -u)
  [ -z "$secs" ] && { log "no active rules"; return 0; }

  $IPT -t mangle -N golden_speed 2>/dev/null
  $IPT -t mangle -A PREROUTING -j golden_speed 2>/dev/null
  $IPT -t mangle -A POSTROUTING -j golden_speed 2>/dev/null

  local built=""     # 已建基础设施的 dev（空格分隔）
  local maps=""      # "dev:ifb" 映射
  local ni=0         # ifb 全局计数
  local sec

  for sec in $secs; do
    local active
    active=$(uci -q get golden.$sec.active)
    [ "$active" = "1" ] || continue

    local dev mode up down
    dev=$(uci -q get golden.$sec.dev)
    mode=$(uci -q get golden.$sec.mode)
    up=$(uci -q get golden.$sec.up);       up=${up:-0}
    down=$(uci -q get golden.$sec.down);   down=${down:-0}
    [ -n "$dev" ] || continue
    [ -e "/sys/class/net/$dev" ] || { log "dev $dev not exist, skip $sec"; continue; }

    # ---- 基础设施（每个 dev 仅一次）----
    local ifb=""
    local p
    for p in $maps; do
      if [ "${p%%:*}" = "$dev" ]; then ifb="${p##*:}"; break; fi
    done
    if [ -z "$ifb" ]; then
      case " $built " in
        *" $dev "*)
          # 已建过但未记 maps（理论上不会发生），补建 ifb
          ni=$((ni + 1))
          ifb="ifb_s$ni"
          ;;
        *)
          ni=$((ni + 1))
          ifb="ifb_s$ni"
          $TC qdisc add dev "$dev" root handle 1: htb default 9999 2>/dev/null
          $TC class add dev "$dev" parent 1: classid 1:9999 htb rate 1000000kbit 2>/dev/null
          $TC qdisc add dev "$dev" handle ffff: ingress 2>/dev/null
          $IP link add "$ifb" type ifb 2>/dev/null
          $IP link set "$ifb" up 2>/dev/null
          $TC qdisc add dev "$ifb" root handle 1: htb default 9999 2>/dev/null
          $TC class add dev "$ifb" parent 1: classid 1:9999 htb rate 1000000kbit 2>/dev/null
          $TC filter add dev "$dev" parent ffff: protocol ip prio 1 u32 match u32 0 0 action mirred egress redirect dev "$ifb" 2>/dev/null
          built="$built $dev"
          ;;
      esac
      maps="$maps $dev:$ifb"
    fi

    # ---- 时间控制参数 ----
    local targs=""
    local timecontrol
    timecontrol=$(uci -q get golden.$sec.timecontrol)
    if [ "$timecontrol" = "1" ]; then
      local ts
      ts=$(uci -q get golden.$sec.timeslots)
      targs="$(time_slots "$ts")"
    fi

    add_rule() { # $1=标记值 $2=源起 $3=源止 $4=上行或下行(u/d)
      local m=$1 rs=$2 re=$3 dir=$4
      local tline
      if [ -n "$targs" ]; then
        local a b
        while read -r a b; do
          [ -n "$a" ] || continue
          if [ "$dir" = "u" ]; then
            $IPT -t mangle -A golden_speed -o "$dev" -m time --kerneltz --timestart "$a" --timestop "$b" -m iprange --src-range "$rs-$re" -j MARK --set-mark "$m" 2>/dev/null
          else
            $IPT -t mangle -A golden_speed -i "$dev" -m time --kerneltz --timestart "$a" --timestop "$b" -m iprange --dst-range "$rs-$re" -j MARK --set-mark "$m" 2>/dev/null
          fi
        done <<EOF
$targs
EOF
      else
        if [ "$dir" = "u" ]; then
          $IPT -t mangle -A golden_speed -o "$dev" -m iprange --src-range "$rs-$re" -j MARK --set-mark "$m" 2>/dev/null
        else
          $IPT -t mangle -A golden_speed -i "$dev" -m iprange --dst-range "$rs-$re" -j MARK --set-mark "$m" 2>/dev/null
        fi
      fi
    }

    add_tc() { # $1=标记值 $2=带宽kbps $3=设备(u=wan / d=ifb)
      local m=$1 kb=$2 where=$3
      [ "$kb" -gt 0 ] 2>/dev/null || return 0
      local tdev
      [ "$where" = "u" ] && tdev="$dev" || tdev="$ifb"
      $TC class add dev "$tdev" parent 1: classid 1:$m htb rate ${kb}kbit ceil ${kb}kbit 2>/dev/null
      $TC filter add dev "$tdev" parent 1: protocol ip prio 1 handle $m fw classid 1:$m 2>/dev/null
    }

    # ---- 规则体 ----
    if [ "$mode" = "single" ]; then
      # 单独限制：范围内每个 IP 独立建 class
      local ips oifs ip
      ips=$(uci -q get golden.$sec.ips)
      oifs=$IFS; IFS=","
      for ip in $ips; do
        [ -n "$ip" ] || continue
        ni=$((ni + 1))
        local mark=$((10 + ni)) umark=$((100 + ni))
        add_rule "$mark" "$ip" "$ip" d
        add_rule "$umark" "$ip" "$ip" u
        add_tc "$mark" "$down" d
        add_tc "$umark" "$up" u
      done
      IFS=$oifs
    else
      # 共享限制：整段一个 class
      local rs re
      rs=$(uci -q get golden.$sec.rstart)
      re=$(uci -q get golden.$sec.rend)
      [ -n "$rs" ] || continue
      ni=$((ni + 1))
      local mark=$((10 + ni)) umark=$((100 + ni))
      add_rule "$mark" "$rs" "$re" d
      add_rule "$umark" "$rs" "$re" u
      add_tc "$mark" "$down" d
      add_tc "$umark" "$up" u
    fi
  done

  log "speed limit applied"
}

stop() { stop_all; log "speed limit stopped"; }

case "$1" in
  start) start ;;
  stop) stop ;;
  restart) start ;;
  *) echo "usage: $0 {start|stop|restart}" >&2; exit 1 ;;
esac
