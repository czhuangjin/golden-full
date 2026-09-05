#!/bin/sh
# ============================================================
# 黄金定制 — DNS 审计守护（批5 扩展：全量行为审计 + 拦截审计）
# 功能1（上网行为审计）: golden.dnsaudit.enabled=1 → 记录全部 DNS 查询
#                        到 /tmp/golden_dnsaudit.log（时间|客户端IP|域名）
# 功能2（域名拦截审计）: golden.domainfilter.audit=1 且 mode=filter →
#                        命中黑名单的查询追加到 /tmp/golden_dnsblock.log
# 用法: /etc/golden/dnsaudit.sh {start|stop|restart}
# 说明: 任一功能开启时自动写入 dnsmasq log-queries=extra + log-facility；
#       全量日志超 5000 行、拦截日志超 2000 行自动截断。
# ============================================================

PIDFILE=/tmp/golden-dnsaudit.pid
DNSLOG=/tmp/dnsmasq.log
LIST=/etc/golden/domfilter.list
AUDIT=/tmp/golden_dnsaudit.log
BLOCK=/tmp/golden_dnsblock.log
CONF=/tmp/dnsmasq.d/golden-dnsaudit.conf
MAXAUDIT=5000
MAXBLOCK=2000

dns_audit_on()   { [ "$(uci -q get golden.dnsaudit.enabled)" = "1" ] && return 0; return 1; }
block_audit_on() {
  [ "$(uci -q get golden.domainfilter.audit)" = "1" ] || return 1
  [ "$(uci -q get golden.domainfilter.mode)" = "filter" ] || return 1
  return 0
}
any_on() { dns_audit_on || block_audit_on; }

# 确保 dnsmasq 记录查询；任一功能开启时写入 conf，全关时移除并重启 dnsmasq
ensure_dnslog() {
  if any_on; then
    mkdir -p /tmp/dnsmasq.d
    {
      echo "log-queries=extra"
      echo "log-facility=$DNSLOG"
    } > "$CONF"
    # conf 内容变化才重启 dnsmasq（避免每次 start 都重启）
    if [ ! -f /tmp/dnsmasq.d/.dnsaudit_mark ] || ! cmp -s "$CONF" /tmp/dnsmasq.d/.dnsaudit_mark; then
      cp -f "$CONF" /tmp/dnsmasq.d/.dnsaudit_mark
      /etc/init.d/dnsmasq restart 2>/dev/null
    fi
  else
    if [ -f "$CONF" ]; then
      rm -f "$CONF" /tmp/dnsmasq.d/.dnsaudit_mark
      /etc/init.d/dnsmasq restart 2>/dev/null
    fi
  fi
}

start() {
  stop
  any_on || { echo "dns audit disabled"; return 0; }
  ensure_dnslog
  # 后台守护循环：增量跟踪 /tmp/dnsmasq.log
  nohup sh -c '
    A_ON=$1; B_ON=$2; LISTF=$3; AUDITF=$4; BLOCKF=$5; MAXA=$6; MAXB=$7; DLOG=$8
    POS=0
    trunc() { # $1=file $2=max
      if [ "$(wc -l < "$1" 2>/dev/null)" -gt "$2" ]; then
        tail -n "$2" "$1" > "$1.tmp" && mv "$1.tmp" "$1"
      fi
    }
    while true; do
      if [ -f "$DLOG" ]; then
        TOTAL=$(wc -l < "$DLOG" 2>/dev/null)
        [ -z "$TOTAL" ] && TOTAL=0
        if [ "$TOTAL" -gt "$POS" ]; then
          tail -n +$((POS + 1)) "$DLOG" 2>/dev/null | while IFS= read -r line; do
            case "$line" in
              *"query"*)
                dom=$(echo "$line" | sed -n "s/.*query\[[^]]*\] \([^ ]*\) from.*/\1/p")
                ip=$(echo "$line" | sed -n "s/.*from \([0-9.]*\)$/\1/p")
                [ -n "$dom" ] || continue
                [ -n "$ip" ] || continue
                if [ "$A_ON" = "1" ]; then
                  echo "$(date "+%Y-%m-%d %H:%M:%S")|$ip|$dom" >> "$AUDITF"
                  trunc "$AUDITF" "$MAXA"
                fi
                if [ "$B_ON" = "1" ] && grep -qF "$dom" "$LISTF" 2>/dev/null; then
                  echo "$(date "+%Y-%m-%d %H:%M:%S")|$ip|$dom" >> "$BLOCKF"
                  trunc "$BLOCKF" "$MAXB"
                fi
                ;;
            esac
          done
          POS=$TOTAL
        fi
      fi
      sleep 3
    done
  ' _ "$(dns_audit_on && echo 1 || echo 0)" "$(block_audit_on && echo 1 || echo 0)" "$LIST" "$AUDIT" "$BLOCK" "$MAXAUDIT" "$MAXBLOCK" "$DNSLOG" >/dev/null 2>&1 &
  echo $! > "$PIDFILE"
  echo "dns audit started (pid $(cat "$PIDFILE"))"
}

stop() {
  if [ -f "$PIDFILE" ]; then
    local pid
    pid=$(cat "$PIDFILE" 2>/dev/null)
    [ -n "$pid" ] && kill "$pid" 2>/dev/null
    rm -f "$PIDFILE"
  fi
  echo "dns audit stopped"
}

case "$1" in
  start) start ;;
  stop) stop ;;
  restart) start ;;
  *) echo "usage: $0 {start|stop|restart}" >&2; exit 1 ;;
esac
exit 0
