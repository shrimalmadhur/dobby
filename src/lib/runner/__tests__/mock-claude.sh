#!/bin/bash
# Mock Claude CLI for integration tests.
# Reads stdin (prompt) and outputs stream-json events simulating an agent run.
# Supports different behaviors via MOCK_CLAUDE_MODE env var.

MODE="${MOCK_CLAUDE_MODE:-success}"

# Read stdin to avoid broken pipe
cat > /dev/null

case "$MODE" in
  success)
    echo '{"type":"assistant","message":{"model":"claude-sonnet-4-20250514","content":[{"type":"text","text":"Here is the full analysis of ingredient X. It has a nutrition score of 75/100 based on fiber content, vitamin density, and processing level."}]}}'
    echo '{"type":"result","result":"Here is the full analysis of ingredient X. It has a nutrition score of 75/100 based on fiber content, vitamin density, and processing level.","model":"claude-sonnet-4-20250514","input_tokens":500,"output_tokens":100}'
    ;;
  success_with_tools)
    echo '{"type":"assistant","message":{"model":"claude-sonnet-4-20250514","content":[{"type":"tool_use","id":"tool_1","name":"read_file","input":{"path":"data.json"}}]}}'
    echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool_1","content":"{}"}]}}'
    echo '{"type":"assistant","message":{"model":"claude-sonnet-4-20250514","content":[{"type":"text","text":"Analysis complete with score 85/100."}]}}'
    echo '{"type":"result","result":"Analysis complete with score 85/100.","model":"claude-sonnet-4-20250514","input_tokens":800,"output_tokens":200}'
    ;;
  failure)
    echo '{"type":"assistant","message":{"model":"claude-sonnet-4-20250514","content":[{"type":"text","text":"Error encountered"}]}}'
    exit 1
    ;;
  memory_subagent)
    # For memory sub-agent mode: output updated memory text (text format, not JSON)
    echo "## Processed Items"
    echo "- Ingredient X (analyzed, score 75/100)"
    echo ""
    echo "## Notes"
    echo "- Nutrition scoring based on fiber, vitamins, processing"
    ;;
  timeout)
    sleep 60
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    exit 1
    ;;
esac
