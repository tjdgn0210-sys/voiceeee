# M0 확인 기록

M0 단계의 확인 결과를 날짜와 함께 적는다. M0-02(Supabase 확인 필요 3건)의 결과도 이 파일에 추가한다.

## M0-06 저장소 기준선 (2026-10-03)

M1 이후 회귀 비교의 기준이다. 기준 커밋 `c42f8eb`에 커밋되지 않은 변경(`AGENTS.md`, `CLAUDE.md`, `design/`, `docs/`)이 얹힌 상태에서 실행했다. `src/`, `server/` 코드는 변경 없음.

### 환경

| 항목 | 값 |
| --- | --- |
| OS | Windows 11 Pro |
| Node | v24.14.0 (`package.json` 요구: >=24.0.0) |
| pnpm | 11.25.0 (`packageManager`와 같음) |

### 결과

| 순서 | 명령 | 결과 | 비고 |
| --- | --- | --- | --- |
| 1 | `pnpm install --frozen-lockfile` | 통과 | "Already up to date". `pnpm-lock.yaml` 변경 없음(실행 전후 SHA-1 동일) |
| 2 | `pnpm typecheck` (`tsc --noEmit`) | 통과 | 오류 0 |
| 3 | `pnpm lint` (`expo lint`) | 통과 | 오류 0 · 경고 0. 아래 "lint 범위" 참고 |
| 4 | `pnpm test` | 통과 | 시험 9개 · 통과 9 · 실패 0 |
| 5 | `pnpm server:test` | 통과 | 시험 8개 · 통과 8 · 실패 0 |

`pnpm test` 실행 중 `ExperimentalWarning: SQLite is an experimental feature` 경고가 나온다(Node 내장 `node:sqlite` 사용 때문). 실패가 아니다.

### lint 범위

- `expo lint`는 `/src`, `/app`, `/components`만 검사한다(`npx expo lint --help`의 설명). 그래서 `design/`과 `server/`는 `pnpm lint`에 포함되지 않는다. `eslint.config.js`는 `dist/**`, `scripts/**`를 제외한다.
- 참고로 `npx eslint .`(저장소 전체)로 돌리면 문제가 5개(오류 3, 경고 2) 나온다. `pnpm lint` 결과가 아니므로 기준선 실패로 보지 않는다. 설정은 바꾸지 않았다.

| 파일 | 줄 | 종류 | 규칙 | 내용 |
| --- | --- | --- | --- | --- |
| `design/script.js` | 1423 | 경고 | `no-unused-vars` | `aiRemaining`을 만들고 쓰지 않음 |
| `design/script.js` | 2172 | 경고 | `no-unused-vars` | `addTab`을 만들고 쓰지 않음 |
| `server/src/provider.mjs` | 37 | 오류 | `no-undef` | `Buffer`가 정의되지 않음(Node 전역을 모르는 설정) |
| `server/src/server.mjs` | 15 | 오류 | `no-undef` | 위와 같음 |
| `server/test/gateway.test.mjs` | 83 | 오류 | `no-undef` | 위와 같음 |

### 시험 실행기와 위치

| 대상 | 명령 | 실행기 | 위치 · 형식 |
| --- | --- | --- | --- |
| 앱 | `pnpm test` = `node --test scripts/verify-*.cjs` | Node 내장 시험 실행기(`node:test`), 별도 라이브러리 없음 | `scripts/verify-*.cjs` 9개. 각 파일이 `typescript`의 `transpileModule`로 `src/`의 `.ts`를 그 자리에서 변환해 불러오고 `node:assert/strict`로 검사한다. 대부분 `test()`로 나누지 않아 **파일 1개 = 시험 1개**로 집계된다. DB 시험은 `node:sqlite`의 메모리 DB를 쓴다 |
| 서버 | `pnpm server:test` = `npm --prefix server test` → `node --test test/*.test.mjs` | Node 내장 시험 실행기 | `server/test/gateway.test.mjs` 1개 파일, `test()` 8개 |

- `src/` 안에는 `*.test.ts` 파일이 없다.
- `scripts/`는 `CLAUDE.md`의 수정 허용 범위에 들어 있지 않다(M0-01 점검 항목으로 올림).

#### 앱 시험 파일 목록 (9개, 모두 통과)

`verify-ai-integration.cjs`, `verify-capture-ai-fallback.cjs`, `verify-capture-parser-router.cjs`, `verify-database.cjs`, `verify-frontend-hardening.cjs`, `verify-repositories.cjs`, `verify-text-expense-parser.cjs`, `verify-transaction-execution.cjs`, `verify-voice-capture.cjs`

`scripts/browser-ai-smoke.cjs`는 이름이 `verify-*`가 아니라서 `pnpm test`에 포함되지 않는다.

### 이번에 하지 않은 것

- `pnpm web` 화면 확인: 앱 소유자 지시로 하지 않음.
- 옛 복제본 정리: 앱 소유자 지시로 목록만 적고 삭제하지 않음.

| 위치 | 내용 | 판단 |
| --- | --- | --- |
| `C:\voice-good` | `package.json` 이름 `voice-life-manager`, `.git` 없음, 약 3.4MB | 앱 사본 |
| `C:\Users\user\Desktop\voice-life-manager-master` | `package.json` 이름 `voice-life-manager` | 앱 사본(이전 이름) |
| `C:\Users\user\Downloads\voice-good-main.zip` | 2026-10-02, 약 2.4MB | 앱 압축본으로 보임(압축을 열어 보지 않음) |
| `C:\Users\user\Downloads\voice-life-manager-master.zip` | 2026-09-28, 약 1.9MB | 위와 같음 |

`C:\voice_tts`, `C:\Users\user\Desktop\voice_tts`는 Python 파일(`main.py`, `model.py`)만 있어 이 앱과는 다른 프로젝트로 보인다. 정리 대상에 넣지 않았다. M0-prepare.md가 예로 든 `C:\voice-good\voice-good-main`은 존재하지 않는다.
