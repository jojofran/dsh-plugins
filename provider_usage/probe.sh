#!/usr/bin/env bash
# probe.sh — 用量/余额端点探测脚本（调查用，不打印任何 key）
# 读取 ~/.dsh/.credentials.yaml 中的 key，对候选端点发 GET，打印状态码 + 响应体前 600 字符。
set -uo pipefail

CRED="$HOME/.dsh/.credentials.yaml"
pick() { # pick <envName> — 从 yaml 取 apiKeyEnv 对应的值
  awk -v k="$1" '$1 == k ":" { sub(/^[^:]*:[[:space:]]*/, ""); print; exit }' "$CRED"
}

QK=$(pick QWEN_TOKEN_PLAN_CN_API_KEY)   # qwen-token-plan-cn
GOK=$(pick OPENCODE_GO_API_KEY)         # opencode-go
ZK=$(pick ZAI_API_KEY)                  # zai

probe() { # probe <label> <auth-header-value|-> <url> [extra-header...]
  local label="$1" auth="$2" url="$3"; shift 3
  local args=(-s -o /tmp/probe_body.$$ -w '%{http_code}' --max-time 20)
  if [ "$auth" != "-" ]; then args+=(-H "Authorization: $auth"); fi
  for h in "$@"; do args+=(-H "$h"); done
  local code
  code=$(curl "${args[@]}" "$url")
  echo "### [$label] $url"
  echo "    HTTP $code"
  if [ "$code" != "000" ] && [ "$code" != "404" ] && [ "$code" != "401" ] && [ "$code" != "403" ]; then
    head -c 600 /tmp/probe_body.$$; echo
  else
    head -c 300 /tmp/probe_body.$$; echo
  fi
  echo
}

echo "=== QWEN-TOKEN-PLAN-CN  (base https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1) ==="
probe "sanity models"        "Bearer $QK" "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/models"
probe "balance (compatible)" "Bearer $QK" "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/balance"
probe "dashscope balance"    "Bearer $QK" "https://dashscope.aliyuncs.com/api/v1/balance" "Accept: application/json"
probe "tokenplan usage (直连猜测)" "Bearer $QK" "https://token-plan.cn-beijing.maas.aliyuncs.com/tokenplan/personal/api/v2/usage"

echo "=== OPENCODE-GO  (base https://opencode.ai/zen/go/v1) ==="
probe "sanity models" "Bearer $GOK" "https://opencode.ai/zen/go/v1/models"
probe "quota"         "Bearer $GOK" "https://opencode.ai/zen/go/quota"
probe "v1/quota"      "Bearer $GOK" "https://opencode.ai/zen/go/v1/quota"
probe "v1/usage"      "Bearer $GOK" "https://opencode.ai/zen/go/v1/usage"
probe "z.ai monitor"  "Bearer $GOK" "https://api.z.ai/api/monitor/usage/quota/limit"

echo "=== ZAI (智谱, base https://open.bigmodel.cn) ==="
probe "sanity models"      "Bearer $ZK" "https://open.bigmodel.cn/api/paas/v4/models"
probe "monitor quota/bearer"  "Bearer $ZK" "https://open.bigmodel.cn/api/monitor/usage/quota/limit"
probe "monitor quota/nobearer" "$ZK"      "https://open.bigmodel.cn/api/monitor/usage/quota/limit"
probe "paas v4 balance"    "Bearer $ZK" "https://open.bigmodel.cn/api/paas/v4/balance"
probe "maas v1 balance"    "Bearer $ZK" "https://open.bigmodel.cn/api/maas/v1/balance"

rm -f /tmp/probe_body.$$