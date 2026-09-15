// Publishing-command cases for scan-ai-tells --command, shared by the three evals that
// drive it: the scanner itself (evals/ai-tells), the Claude and Codex hook
// (evals/codex-marketplace), and the OpenCode plugin (evals/opencode-dist). Each blocked
// case is one distinct way an attribution trailer reaches a published value; each allowed
// case is one distinct way a naive extractor would over-block.

export const COMMAND_CASES = [
  {
    name: 'a trailer as a second inline -m value',
    command: 'git commit -m "Fix the lexer" -m "Co-authored-by: Claude <noreply@anthropic.com>"',
    blocked: true,
  },
  {
    name: 'a trailer in a --message= value',
    command: 'git commit -m "Fix the lexer" --message="Co-authored-by: GPT <bot@openai.com>"',
    blocked: true,
  },
  {
    name: 'a trailer passed through --trailer',
    command: 'git commit -m "Fix the lexer" --trailer "Co-authored-by: Claude <noreply@anthropic.com>"',
    blocked: true,
  },
  {
    name: 'an inline gh pr create --body with an escaped-newline trailer',
    command: 'gh pr create --title "Fix the lexer" --body "Summary.\\n\\nCo-authored-by: Anthropic <noreply@anthropic.com>"',
    blocked: true,
  },
  {
    name: 'a heredoc message body',
    command: 'git commit -m "$(cat <<\'EOF\'\nFix the lexer\n\nCo-authored-by: Claude <noreply@anthropic.com>\nEOF\n)"',
    blocked: true,
  },
  {
    name: 'a clean multi -m commit',
    command: 'git commit -m "Fix the lexer" -m "Handle quoted values and heredoc bodies."',
    blocked: false,
  },
  {
    name: 'a trailer phrase outside any message argument',
    command: 'rg -n "Co-authored-by: Claude" NOTES.md && git commit -m "Fix the lexer"',
    blocked: false,
  },
  {
    name: 'a clean gh pr create --body',
    command: 'gh pr create --title "Fix the lexer" --body "Summary.\\n\\nThe scanner now reads published values."',
    blocked: false,
  },
];
