# Live reliability verification policy

This policy keeps broadcast-critical work safe without paying the cost of a full backtest for every edit.

## 1. Classify the change

| Risk | Typical changes | Required verification |
| --- | --- | --- |
| Low | copy, color, spacing, static label | syntax check and targeted visual inspection |
| Medium | isolated parser, formatter, one UI control | focused tests plus one adjacent regression path |
| High | bid acceptance, countdown, sold/reopen, assignment, queue, session, channel switch, shipping state | focused invariant backtest and the full affected repository suite |
| Release | cross-repository contract, public payload, persistence, deployment/runtime configuration | high-risk checks, both repository suites, real-screen check, and read-only production verification |

If uncertain, use the higher level. User instructions can explicitly raise or lower the scope.

## 2. High-risk invariant matrix

Test only the rows relevant to the changed state machine; avoid an exhaustive Cartesian product.

- Same request repeated: one durable effect and an idempotent response.
- Same participant repeated: stable identity and no duplicate assignment, chat, animation, or total.
- Multiple participants concurrently: deterministic accepted order or a documented ordering rule.
- Save order reversed: late/stale writes cannot overwrite newer authoritative state.
- Reload/reconnect: no replay of completed effects and no loss of durable state.
- Process/service restart: persisted identity, session, and result survive restart.
- Timeout/storage failure: the auction remains usable and fails closed rather than inventing state.
- Lifecycle boundary: waiting → live → sold/passed → reopened → archived → next session.
- Channel boundary: no cross-channel read, write, cache, capture, or broadcast leakage.
- Privacy boundary: public payloads exclude phone numbers, raw platform member keys, and admin data.

For queues, additionally prove FIFO order, duplicate suppression, backlog timing, and non-blocking auction acceptance.

## 3. Resource controls

- During implementation, run only the focused test file or named scenario.
- Run the full suite once when the implementation is stable, and again only after material code changes.
- Prefer injected clocks, fake repositories, deterministic random seeds, and controlled promises/threads over real sleeps.
- Use isolated temporary storage for integration checks and clean it up afterward.
- Reuse one real-screen session to verify several visual assertions when possible.
- Production verification must be read-only unless the user explicitly authorizes test data.

## 4. Default commands

Desktop monitor:

```text
python -m unittest discover -p "test*.py"
```

Live web/server (`tmp/CREO-live`):

```text
npm run check
npm test
```

Before committing:

```text
git diff --check
```

Also validate every changed Korean text file as strict UTF-8 and scan for `U+FFFD`.

## 5. Completion evidence

Record:

- the risk level and state invariants exercised;
- exact test commands and pass/fail counts;
- real-screen scenarios checked, when required;
- deployment and production health/static results, when required;
- remaining assumptions or untestable external dependencies.
