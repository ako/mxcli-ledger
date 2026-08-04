#!/bin/bash
# Samples Prometheus counters every 60s into a CSV.
# Note: jvm_memory_used_bytes carries an `id` label containing spaces, so the
# value is $NF, not $2 — and handler_requests_total has a name= label too.
OUT="$1"
CSV="$OUT/metrics.csv"
[ -f "$CSV" ] || echo "ts,selects,inserts,updates,deletes,transactions,xas_requests,sessions,heap_mb,threads" > "$CSV"
while true; do
  M=$(curl -s --max-time 5 http://127.0.0.1:8090/prometheus)
  if [ -n "$M" ]; then
    g() { echo "$M" | grep -m1 "^$1" | awk '{print $NF}'; }
    HEAP=$(echo "$M" | awk '/^jvm_memory_used_bytes.area="heap"/ {s+=$NF} END {printf "%.0f", s/1048576}')
    XAS=$(echo "$M" | awk '/^mx_runtime_stats_handler_requests_total.*xas/ {print $NF}')
    echo "$(date -u +%FT%TZ),$(g mx_runtime_stats_connectionbus_selects_total),$(g mx_runtime_stats_connectionbus_inserts_total),$(g mx_runtime_stats_connectionbus_updates_total),$(g mx_runtime_stats_connectionbus_deletes_total),$(g mx_runtime_stats_connectionbus_transactions_total),$XAS,$(g mx_runtime_stats_sessions_anonymous_sessions),$HEAP,$(g jvm_threads_live_threads)" >> "$CSV"
  fi
  sleep 60
done
