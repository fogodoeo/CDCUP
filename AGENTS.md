# Repository working rules

## Encoding safety

- Treat HTML, JavaScript, and CSS as UTF-8.
- Do not bulk-resave files containing Korean text with PowerShell `Get-Content`/`Set-Content`.
- Use `apply_patch` for focused edits.
- After cache-key or bulk string changes, inspect `git diff` for unintended encoding or line-ending rewrites.
- A garbled PowerShell preview is not proof of file corruption; verify with `fs.readFileSync(path, 'utf8')`.
- If replacement characters or broken Korean are detected, restore the file before continuing and reapply only the intended edit.

## Risk-based verification

- Before changing live-auction behavior, read `docs/LIVE_RELIABILITY_CHECKLIST.md` and classify the change as low, medium, high, or release risk.
- Use the smallest test scope that can prove the change during iteration. Do not run the full suite after every cosmetic edit.
- Every reproduced bug must gain a focused regression test when the behavior can be tested deterministically.
- High-risk state changes must test idempotency, duplicate input, concurrency/order, reload/restart, failure behavior, and lifecycle boundaries relevant to the change.
- Run the full affected repository suite once before committing a high-risk change. Run both desktop and server suites for cross-repository live-auction changes.
- Release-risk changes also require a local real-screen check and read-only production health/static verification after deployment.
- Never use production auction records for backtests. Use in-memory or explicitly isolated temporary data.
- Report exact tests run, observed results, and any residual risk. Do not claim a system is “perfect” solely because tests passed.
