Add retry logic to the uploader

This change adds exponential backoff to the S3 uploader.

## Test plan
- ran the suite

Notably, the backoff caps at 30s — and jitter is applied — so retries spread out — avoiding a thundering herd.

🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>
