#!/usr/bin/env bash
# uniflow E2E 流程测试 — 完整闭环（M5 验收脚本）。
#
# 流程：Leader CLI 派发（指派模型）→ headless DSH + 插件强制 →
# worker 加载上下文并执行（强制模型）→ 机器回执核对 → M0 CLI 独立复核。
#
# 用法：bash run-e2e.sh   （需 ~/.dsh 凭证已配置 opencode-go）
# 退出码 0 = 全部通过。
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
REPO_ROOT="/Users/fran/Documents/Code/spacex/uni_claw"
DSH_BIN="/Users/fran/Documents/Code/dk-harness/apps/cli/lib/bin.js"
WI="$PLUGIN_DIR/test/e2e/workitem-e2e.json"
RECORD_DIR="$PLUGIN_DIR/.e2e"

echo "== 1/5 unit gates =="
( cd "$PLUGIN_DIR" && npm test 2>&1 | grep -E '^# (pass|fail)' )

echo "== 2/5 Leader dispatch (model assignment via profile-source) =="
( cd "$REPO_ROOT" && python3 tools/dsh_profile_adapter.py dispatch "$WI" \
    --session-id e2e-session --record-dir "$RECORD_DIR" )

echo "== 3/5 E2E run (worker context load + forced model execution) =="
OUT=$(node "$DSH_BIN" --profile headless \
    --patch "$PLUGIN_DIR/test/e2e/overlay.yml" "uniflow-e2e" 2>&1 | grep UNIFLOW_E2E_RESULT || true)
echo "$OUT" | head -c 600; echo
echo "$OUT" | grep -q '"pass":true' || { echo "E2E_FAIL"; exit 1; }
echo "E2E_PASS"

echo "== 4/5 worker session receipt (machine truth, independent) =="
# 直接用 E2E 结果中的 worker_started.run_id 定位会话目录（确定性，无搜索、
# 无跨会话误报）。日志 flush 有竞态：轮询至多 15s 等待 request/header 落盘。
RUN_ID=$(echo "$OUT" | grep -o '"run_id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$RUN_ID" ] || { echo "NO_RUN_ID_IN_RESULT"; exit 1; }
WORKER_SESSION=""
LOG=""
for _ in $(seq 1 30); do
  for root in /Users/fran/.dsh/sessions/*/; do
    cand="${root}${RUN_ID}/session.jsonl.zstd"
    if [ -f "$cand" ]; then LOG="$cand"; break 2; fi
  done
  sleep 1
done
[ -n "$LOG" ] || { echo "NO_WORKER_SESSION_FOUND run_id=$RUN_ID"; exit 1; }
# 日志存在后，再等 request/header 可解压（flush 完成标志）。
for _ in $(seq 1 30); do
  if zstd -d -c "$LOG" 2>/dev/null | grep -q '"provider":"opencode-go","model":"deepseek-v4-flash"'; then
    WORKER_SESSION="$(dirname "$LOG")"
    break
  fi
  sleep 1
done
[ -n "$WORKER_SESSION" ] || { echo "WORKER_LOG_LACKS_FORCED_MODEL run_id=$RUN_ID"; exit 1; }
echo "worker session: $WORKER_SESSION"

echo "== 5/5 M0 CLI receipt cross-check =="
( cd "$REPO_ROOT" && python3 tools/dsh_profile_adapter.py receipt "$WORKER_SESSION" \
    --work-item-id WI-E2E-001 --worker-owner e2e-worker-1 --record-dir "$RECORD_DIR" )

echo "ALL_STEPS_PASS"
