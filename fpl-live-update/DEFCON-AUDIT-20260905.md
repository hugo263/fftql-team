# DEFCON scoring audit — 2026-09-05

## Conclusion

No missing DEFCON points were found. Do **not** add another +2 to `stats.total_points`: official Draft totals already contain awarded defensive-contribution points, just as they contain bonus points. Existing snapshot and match-detail scoring reads these totals directly.

## Evidence and scope

Read-only official API audit requested at 2026-09-05 06:59:45.776–06:59:48.479 UTC. The retained JSON records each endpoint's exact request and response timestamps. Draft and Classic player masters each contain 652 unique player codes; all Draft codes join to Classic exactly once. IDs were not used across APIs (e.g. Araujo is Draft 580 vs Classic 579, stable code 445087).

| GW | Draft/Classic live records | Played players | Awarded DEFCON | Total mismatch | Explain-sum mismatch |
|---|---:|---:|---:|---:|---:|
| 1 | 610 / 610 | 310 | 31 | 0 | 0 |
| 2 | 626 / 626 | 312 | 29 | 0 | 0 |
| 3 | 652 / 652 | 30 | 4 | 0 | 0 |

The current 652-player master includes players absent from earlier GW live records: 42 absent in GW1, 26 absent in GW2, and none absent in GW3. Missing historical records were retained as missing, not replaced with zero, and were not counted as evidence of successful scoring. There were no duplicate Classic live IDs. This is a point-in-time audit, not a promise that an upstream live feed can never be delayed or corrected.

Current GW3 official breakdowns, identical in Draft and Classic:

- Araujo: 8 = 2 appearance + 4 clean sheet + 2 DEFCON (10 actions).
- Palacios: 4 = 2 appearance + 2 DEFCON (19 actions).
- Diop: 3 = 2 appearance − 1 goals conceded + 2 DEFCON (11 actions).
- O'Shea: 3 = 2 appearance − 1 goals conceded + 2 DEFCON (11 actions).

## Production cross-check

Read-only `http://127.0.0.1:9090/api/snapshot` from the production server returned HTTP 200, snapshot `updated: 2026-09-05T07:00:00.920Z`, with exactly the same four `liveGwPoints`: Diop 3, O'Shea 3, Araujo 8, Palacios 4.

The observed current squad for manager entry 248562 (`英超不倒翁`) has Araujo at position 14 (bench), with manager GW3 score 0. His 8 points include DEFCON but do not count toward the manager's XI score while he remains a substitute. Automatic substitutions count only once and only when officially supplied; no hypothetical substitution is projected. The production cross-check did not change server files, configuration, services or data.

## Official references

- [Premier League DEFCON rules, updated 20 July 2026](https://www.premierleague.com/en/news/4361991): defenders earn 2 points for 10 clearances/blocks/interceptions/tackles; midfielders and forwards require 12 including recoveries; capped at 2 per match.
- [Official Draft GW3 live](https://draft.premierleague.com/api/event/3/live)
- [Official Classic GW3 live](https://fantasy.premierleague.com/api/event/3/live/)
- [Draft player master](https://draft.premierleague.com/api/bootstrap-static)
- [Classic player master](https://fantasy.premierleague.com/api/bootstrap-static/)

## Reproducibility and regression coverage

- `scripts/audit-defcon.cjs` is a read-only audit script; it outputs JSON to stdout and writes no files on the executing machine. Run on a trusted network (local proxy can distort public responses).
- `tests/fixtures/defcon-audit-20260905.json` contains compact per-GW observations, all DEFCON recipients and full current-GW breakdowns, including source timestamps.
- `tests/defcon-scoring.test.js` covers official sum agreement, stable-code identity, each of the four specific official totals, multi-player accumulation, exclusion of bench points and application of official automatic substitution.
- No production scoring formula change was needed.
