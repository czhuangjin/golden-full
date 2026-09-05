#!/bin/sh
# 黄金定制 — 域名过滤真实执行（dnsmasq 直接阻断）
# 用户决策：命中列表域名 → 解析到无效地址（0.0.0.0），访问即失败
# 配置：golden.domainfilter.mode（disable=不启用 / filter=过滤列表中的允许其他 / allow=允许列表中的过滤其他）
#       golden.domfilter_<N>.domain（域名关键字，支持 google / *.sina.* 形式）
#       golden.domainfilter.audit（1=记录被拦截的域名查询日志 → /tmp/golden_dnsblock.log，仅 filter 模式有效）
#       golden.domainfilter.rebind_protect（1=开启 stop-dns-rebind 防 DNS rebinding 攻击）
# 生效：写 /tmp/dnsmasq.d/golden-domainfilter.conf → 重启 dnsmasq；持久副本在 /etc/golden/domainfilter.conf

CONF=/tmp/dnsmasq.d/golden-domainfilter.conf
PERSIST=/etc/golden/domainfilter.conf
LIST=/etc/golden/domfilter.list
BIND=0.0.0.0

stop() {
  rm -f "$CONF" "$PERSIST"
}

start() {
  local mode audit rebind
  mode=$(uci -q get golden.domainfilter.mode)
  audit=$(uci -q get golden.domainfilter.audit)
  rebind=$(uci -q get golden.domainfilter.rebind_protect)
  [ -z "$mode" ] && mode='disable'
  if [ "$mode" = 'disable' ]; then
    rm -f "$CONF" "$PERSIST" "$LIST"
    return 0
  fi
  mkdir -p /tmp/dnsmasq.d
  : > "$CONF"
  : > "$LIST"
  if [ "$mode" = 'allow' ]; then
    # 白名单模式：先把所有域名污染，白名单域名恢复默认上游正常解析
    echo "address=/#/$BIND" >> "$CONF"
  fi
  local n=0
  while :; do
    n=$((n + 1))
    local dom
    dom=$(uci -q get golden.domfilter_$n.domain)
    [ -z "$dom" ] && break
    # 规范化：去 * 与空白、首尾点；空则跳过
    dom=$(echo "$dom" | tr -d '* ' | sed 's/^\.//; s/\.$//')
    [ -z "$dom" ] && continue
    if [ "$mode" = 'filter' ]; then
      # 过滤模式：直接阻断列表中的域名（local= 阻止上游查询，address= 污染解析）
      echo "address=/$dom/$BIND" >> "$CONF"
      echo "local=/$dom/" >> "$CONF"
      echo "$dom" >> "$LIST"
    else
      # allow 模式：列表中的域名放行（恢复默认上游），其余被上面 address=/#/ 污染
      echo "server=/$dom/" >> "$CONF"
    fi
  done
  # DNS 防投毒/防劫持：stop-dns-rebind 拒绝把内网保留地址解析给公网域名
  if [ "$rebind" = "1" ]; then
    echo "stop-dns-rebind" >> "$CONF"
  fi
  # 域名拦截审计：dnsmasq 记录全部查询（audit 仅对 filter 模式有意义）
  if [ "$audit" = "1" ] && [ "$mode" = 'filter' ]; then
    echo "log-queries=extra" >> "$CONF"
    echo "log-facility=/tmp/dnsmasq.log" >> "$CONF"
  fi
  cp -f "$CONF" "$PERSIST" 2>/dev/null
}

case "$1" in
  stop)
    stop
    /etc/init.d/dnsmasq restart 2>/dev/null
    ;;
  start)
    start
    /etc/init.d/dnsmasq restart 2>/dev/null
    ;;
  restart)
    stop
    start
    /etc/init.d/dnsmasq restart 2>/dev/null
    ;;
esac
exit 0
