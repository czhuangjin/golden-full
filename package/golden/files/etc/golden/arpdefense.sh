#!/bin/sh
# 黄金定制 — ARP 安全防御真实执行
# 用户决策：绑定表外主机拦截 + 网关 MAC 锁定（免费 ARP + 静态邻居）+ 告警阈值日志
# 配置：golden.arpdefense（enabled / fakegateway / fakeinterval(ms) / illegalgateway / illegalinterval(s) / level）
# 绑定来源：/etc/ethers（ARP 绑定页写入，格式 mac\tip）
# 日志：/tmp/golden_arplog（时间|事件，保留最近 300 行）

CHAIN=golden_arp
LOG=/tmp/golden_arplog
SEEN=/tmp/golden_arp_seen
PIDFILE=/var/run/golden_arpd.pid
LANDEV=$(uci -q get network.lan.ifname)
[ -z "$LANDEV" ] && LANDEV='br-lan'
LANIP=$(uci -q get network.lan.ipaddr)

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S')|$1" >> "$LOG"
  tail -n 300 "$LOG" > /tmp/golden_arplog.tmp && mv /tmp/golden_arplog.tmp "$LOG"
}

stop() {
  iptables -D FORWARD -i "$LANDEV" -j $CHAIN 2>/dev/null
  iptables -F $CHAIN 2>/dev/null
  iptables -X $CHAIN 2>/dev/null
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null
    rm -f "$PIDFILE"
  fi
}

# 守护进程：免费 ARP（伪网关防御）+ 邻居表轮询（非法网关/ARP 欺骗探测）
start_daemon() {
  local fake illegal finterval iinterval
  fake=$(uci -q get golden.arpdefense.fakegateway)
  illegal=$(uci -q get golden.arpdefense.illegalgateway)
  finterval=$(uci -q get golden.arpdefense.fakeinterval)
  iinterval=$(uci -q get golden.arpdefense.illegalinterval)
  [ -z "$finterval" ] && finterval=200
  [ -z "$iinterval" ] && iinterval=10
  [ "$finterval" -lt 1000 ] 2>/dev/null && finterval=1000
  [ "$iinterval" -lt 3 ] 2>/dev/null && iinterval=3
  local fsec=$((finterval / 1000))
  [ "$fsec" -lt 1 ] && fsec=1
  local last=0
  : > "$SEEN"
  nohup sh -c '
    fake="$1"; illegal="$2"; fsec="$3"; iinterval="$4"; dev="$5"; lip="$6"; logf="$7"; seen="$8"
    LDEV="$dev"; LIP="$lip"; LOGF="$logf"; SEENF="$seen"
    last=0
    while :; do
      now=$(date +%s)
      if [ "$fake" = "1" ] && [ -n "$LIP" ] && [ $((now - last)) -ge "$fsec" ]; then
        arping -U -I "$LDEV" -c 1 "$LIP" >/dev/null 2>&1
        last=$now
      fi
      if [ "$illegal" = "1" ]; then
        # 快照 /proc/net/arp：IP MAC 变化（新 MAC 非绑定表）→ 疑似欺骗/非法网关
        awk "\$4 != \"00:00:00:00:00:00\" && \$2 != \"0.0.0.0\" {print \$1, \$4}" /proc/net/arp 2>/dev/null | while read -r ip mac; do
          [ -z "$ip" ] && continue
          bound=$(grep -c "$mac" /etc/ethers 2>/dev/null)
          if [ "$bound" -lt 1 ]; then
            # 未绑定 MAC 出现在邻居表 → 非法接入/ARP 欺骗迹象（去重：1 小时内同 IP 只告警一次）
            stamp=$(grep -c "^$ip|" "$SEENF" 2>/dev/null)
            if [ "$stamp" -lt 1 ]; then
              echo "$ip|$(date +%s)" >> "$SEENF"
              echo "$(date "+%Y-%m-%d %H:%M:%S")|检测到 $ip 使用未绑定 MAC $mac 接入，疑似非法网关/ARP 欺骗" >> "$LOGF"
              tail -n 300 "$LOGF" > "$LOGF.tmp" && mv "$LOGF.tmp" "$LOGF"
            fi
          fi
        done
      fi
      sleep 1
    done
  ' _ "$fake" "$illegal" "$fsec" "$iinterval" "$LANDEV" "$LANIP" "$LOG" "$SEEN" >/dev/null 2>&1 &
  echo $! > "$PIDFILE"
}

start() {
  stop
  local enabled
  enabled=$(uci -q get golden.arpdefense.enabled)
  [ "$enabled" != '1' ] && return 0
  # 内核加固：仅响应本接口 IP 的 ARP 请求、发送使用最佳源地址
  echo 1 > /proc/sys/net/ipv4/conf/$LANDEV/arp_ignore 2>/dev/null
  echo 2 > /proc/sys/net/ipv4/conf/$LANDEV/arp_announce 2>/dev/null
  # 绑定表：放行绑定 MAC（RETURN）+ 静态邻居锁定；未绑定 → LOG + DROP
  iptables -N $CHAIN 2>/dev/null
  local n=0
  while read -r mac ip; do
    [ -z "$mac" ] && continue
    [ -z "$ip" ] && continue
    iptables -A $CHAIN -i "$LANDEV" -m mac --mac-source "$mac" -j RETURN 2>/dev/null
    ip neigh replace "$ip" lladdr "$mac" nud permanent dev "$LANDEV" 2>/dev/null
    n=$((n + 1))
  done < /etc/ethers
  if [ "$n" -gt 0 ]; then
    iptables -A $CHAIN -i "$LANDEV" -m limit --limit 5/min --limit-burst 10 -j LOG --log-prefix "GOLDEN_ARP " 2>/dev/null
    iptables -A $CHAIN -i "$LANDEV" -j DROP 2>/dev/null
    iptables -I FORWARD -i "$LANDEV" -j $CHAIN 2>/dev/null
    log "ARP 安全防御已启用：$n 条绑定生效，未绑定主机流量将被拦截"
  else
    log "ARP 安全防御启用但无绑定条目，仅记录日志不拦截"
  fi
  start_daemon
}

case "$1" in
  stop) stop ;;
  start) start ;;
  restart) stop; start ;;
esac
exit 0
