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
# BSD find 的 -maxdepth+-name 组合在 "--" 前缀目录下不可靠；改用 shell glob。
# 注意：zstd 解压活会话日志可能带 truncated 警告返回非零 —— grep 判定必须
# 独立于 zstd 退出码（管道整体取 grep 结果，禁 pipefail 连坐）。
WORKER_SESSION=""
for log in /Users/fran/.dsh/sessions/*/*/*.zstd; do
  [ -e "$log" ] || continue
  [ "$log" -nt "$RECORD_DIR/WI-E2E-001.json" ] || continue
  if zstd -d -c "$log" 2>/dev/null | { grep -q '"provider":"opencode-go","model":"deepseek-v4-flash"' || true; }; then
    if zstd -d -c "$log" 2>/dev/null | grep -q '"provider":"opencode-go","model":"deepseek-v4-flash"'; then
      WORKER_SESSION="$(dirname "$log")"
      break
    fi
  fi
done
[ -n "$WORKER_SESSION" ] || { echo "NO_WORKER_SESSION_FOUND"; exit 1; }
echo "worker session: $WORKER_SESSION"

echo "== 5/5 M0 CLI receipt cross-check =="
( cd "$REPO_ROOT" && python3 tools/dsh_profile_adapter.py receipt "$WORKER_SESSION" \
    --work-item-id WI-E2E-001 --worker-owner e2e-worker-1 --record-dir "$RECORD_DIR" )

echo "ALL_STEPS_PASS"
