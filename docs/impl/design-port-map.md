# 시안 ↔ 앱 화면 대응표 (겉모양 맞추기)

결정(2026-10-05, 앱 소유자): 색은 시안(`design/style.css`)의 연보라 팔레트를 그대로 쓴다. 이전 D-8(남색 유지)은 이 결정으로 대체한다. 설계도 PDF는 고치지 않는다.

범위: 겉모양만 바꾼다. `src/domain`, `src/application`, `src/database`, `src/adapters`와 기능은 건드리지 않는다. 새 패키지는 설치하지 않는다.

## 1. 값 대응 (시안 `:root` → `palette` 키, `src/features/capture/expense-styles.ts`)

| 시안 변수 | palette 키 | 값 | 비고 |
| --- | --- | --- | --- |
| `--ink` | `ink` | `#221E33` | 본문 글자 |
| `--muted` | `muted` | `#5F5A73` | 보조 글자 |
| `--accent` | `primary` | `#6B58C4` | 강조 글자 · 링크 · 점 |
| `--primaryFill` | `primaryFill` | `#B8A7F2` | 주 버튼 · 선택된 칸 바탕 (신규) |
| `--onPrimary` | `onPrimary` | `#221E33` | `primaryFill` 위 글자 (흰색 아님, 신규) |
| `--canvas` | `canvas` | `#F4F1FB` | 화면 바탕 |
| `--paper` | `paper` | `#FBFAFE` | 카드 면 |
| `--line` | `line` | `#E3DEF0` | 구분선 |
| `--danger` | `danger` | `#B4382C` | 위험 글자 · 선 |
| `--inputFill` | `inputFill` | `#F0EDF8` | 입력칸 · 알약 바탕 (신규) |
| `--placeholder` | `placeholder` | `#6A6580` | 안내 글자 |
| `--heroFill` | `heroFill` | `#B8A7F2` | 큰 숫자 면 (신규) |
| `--heroInk` | `heroInk` | `#221E33` | (신규) |
| `--heroMuted` | `heroMuted` | `#4C4566` | (신규) |
| `--reviewFill` | `reviewFill` | `#ECE7FA` | 안쪽 면 (값 교체) |
| `--nowFill` | `nowFill` | `#E6E0F7` | 안내 상자 · 이름표 (값 교체) |
| `--dangerFill` | `dangerFill` | `#FBEFEE` | (신규, 기존 `dangerSoft` 대체) |
| `--dangerLine` | `dangerLine` | `#E4B9B3` | (신규, 기존 `dangerBorder` 대체) |
| `--overlayFill` | `overlayFill` | `#F4F1FBEE` | 덮개 면 (신규, 아직 쓰는 화면 없음) |

없앤 키: `reviewBorder`, `softBorder`, `inputBorder`, `success*`, `warn*`(시안에 없는 색). 새 색은 만들지 않는다.

디자인 규칙: 테두리 · 그림자 없이 색 면으로 구분한다. 시안이 실제로 테두리를 쓰는 곳(보조 버튼의 가는 선, 선택된 칸의 진한 테두리, 목록 사이 선)만 쓴다. 큰 숫자 · 제목만 세리프(`Fonts.serif`). 글자 크기는 기존 `fontScale`(`scaleFont`)을 그대로 쓴다.

## 2. 화면 대응 (진행 순서대로)

| 묶음 | 시안 위치 | 앱 파일 | 맞출 것 |
| --- | --- | --- | --- |
| 공통 | `.header` `.settingsButton` | `src/app/(tabs)/_layout.tsx`, `src/composition/root-stack.tsx` | 헤더가 바탕색과 같고 선이 없음, 오른쪽 설정 알약 하나 |
| 공통 | `.tabBar` `.tabButton` | `src/components/app-tab-bar.tsx` | 바탕 canvas + 위 가는 선, 선택 탭은 위 3px 줄 + reviewFill 면 + 굵은 밑줄 글자 |
| 공통 | `.undoToast` | `src/components/undo-bar.tsx` | ink 면 + canvas 글자 + primaryFill 버튼 글자 |
| 공통 | `.input` `.segment` `.pill` `.toggle` `.panelSoft` | `features/calendar/form-controls.tsx`, `picker-field(.web).tsx`, `features/capture/expense-styles.ts` | 입력 · 선택 · 스위치 모양 |
| 1 | `#homeScreen` | `features/home/home-screen.tsx`, `features/capture/capture-composer.tsx` | 머리말 · 오늘 합계 hero · 빠른 기록 카드(알약 말하기 버튼, 링크 보조 동작) · 오늘 일정 카드 · 최근 기록 |
| 1 | `#calendarPage` | `features/calendar/calendar-screen.tsx`, `event-row.tsx`, `task-row.tsx` | 한 카드 안에 제목 · 보기 전환 알약 · 이전/다음 · 월/주 칸 · 날짜별 목록 |
| 1 | `#editSheet` | `features/calendar/entry-form-screen.tsx` | 일정 · 할 일 입력(알약 선택, 입력칸, 스위치 패널) |
| 1 | `#itemSheet` | `features/calendar/event-detail-screen.tsx` | 일정 상세(제목 · 시각 · 알림 · 버튼 · 글자 링크 삭제) |
| 2 | `#expensesPage` | `features/money/expenses-screen.tsx` | 머리말 · 월 이동 카드 · 큰 합계 · 카테고리별 막대 · 목록 |
| 2 | `#expenseSheet` `#expenseEditSheet` | `features/money/expense-detail-screen.tsx`, `features/capture/manual-expense-screen.tsx`, `expense-fields.tsx`, `expense-date-fields(.web).tsx`, `draft-status.tsx` | 지출 상세 · 입력 · 수정 |
| 2 | `#peoplePage` | `features/people/people-screen.tsx` | M4 전이므로 머리말 + 로그인 필요 안내 카드(잠금 · 빈 상태)만 |
| 2 | `#onboardPage` (O1·O2) | `features/onboarding/onboarding-screen.tsx` | 환영 · 알림 설명 · 시작 |
| 3 | `#settingsPage` | `features/settings/settings-screen.tsx`, `notification-settings.tsx`, `notification-permission-notice.tsx`, `about-section.tsx`, `reset-section.tsx` | 묶음 라벨 + 패널 안의 설정 줄 |
| 3 | `.fontPercent` 글자 크기 | `features/settings/font-size-screen.tsx`, `step-slider.tsx` | 큰 퍼센트 · 슬라이더 · [−][+] |
| 3 | `#exportSheet` | `features/settings/export-screen.tsx` | 알약 선택 · 파일 요약 면 |
| 3 | `#dangerSheet` | `features/settings/reset-section.tsx` | 위험 확인(빨간 버튼, 단어 입력) |
| 3 | (정보) | `features/settings/licenses-screen.tsx`, `ai-connection-screen.tsx` | 같은 패널 · 카드 모양 |

## 3. 시안에 있으나 앱에 없는 화면 · 요소 (만들지 않음)

- M2 이후 기능: 로그인 선택(O3) · 닉네임(O4) · 기본 공개(O5) · 백업 선택(O6) · 복원 중(O7), 내 프로필 · 닉네임 변경 · 프로필 사진 시트, 로그아웃 · 탈퇴 · 다른 기기 로그인 시트, 백업 상태.
- M3: AI 해석 횟수 hero(설정 상단 · 홈 남은 횟수 줄), AI 필요 안내(`routeBox`), 첫 AI 사용 동의, 다중 액션 결과 카드.
- M4: 친구 추가 · 링크 열기 · 친구 상세 · 별명 · 차단 · 신고 시트, 수신함 · 보낸 항목, 보내기 시트, 친구 일정 겹쳐 보기, 받은 항목 배지(`homeReceived`), 친구별 알림, 받기 설정, 공개 범위 설정.
- M5: 요금제(`#planPage`) · 구독 · 구매 복원.
- 시안 전용 연출: 캐릭터(`#pet`) · 말풍선 · 녹음 오버레이(`#startOverlay`), 디자인 바(`.designBar`).
- 시안에만 있는 동작: 캘린더 **일 보기**(앱은 월 · 주), 알림 문구 미리보기(`notifPreview`), 지출 `합계에 포함` 토글(앱에는 바꾸는 화면이 없음).
- **이번 범위에서 제외(결정):** 포인트 색 · 바탕색을 사용자가 고르는 설정(`buildPalette`, `#settingsSheet`). 기본 연보라만 쓴다.

## 4. 진행 결과 (2026-10-05)

묶음 1~2는 `d65fd7e` · `e513034`, 묶음 3(설정과 하위 화면 · 헤더 제목)은 이 문서와 같은 커밋에서 맞췄다. 웹(`pnpm web`, 폭 430px)에서 시안과 나란히 눈으로 비교했고, 실기기 확인은 앱 소유자 몫이다.

묶음 3에서 시안과 달라진 점 · 정한 점(권장안으로 진행):

- 설정 화면은 시안의 `#settingsPage`처럼 머리말 + 묶음(`SettingGroup`) + 색 면 패널(`SettingPanel`) 안의 줄(`SettingRow` · `SettingSwitch`)로 만들었다. 공용 조각은 `features/settings/setting-parts.tsx`.
- 시안의 "내 데이터" 화면(`#dataPage`)은 따로 만들지 않고 설정 안의 두 묶음 **내보내기** · **초기화**로 합쳤다(백업 상태 · 친구 초기화는 M2 이후).
- **초기화**는 시안의 `#dangerSheet`처럼 하단 시트(`components/bottom-sheet.tsx`, RN `Modal`)에서 2단계로 한다: 지워지는 것 목록 + [계속] → "삭제" 입력 + 빨간 버튼. 길게 눌러 확인하는 방식은 만들지 않았다(단어 입력만).
- 시안에 없는 앱 기능 **AI 연결**은 "화면 · 연결" 묶음에 줄로 넣었다.
- 시안의 알림 줄 중 "친구별 알림" · "알림 문구 미리보기"는 만들지 않았다(M4 · 시안 전용 연출). 알림 권한은 시안처럼 값 + 안내 블록으로 보인다.
- 켜고 끄는 스위치는 시안대로 손잡이 위치(왼쪽 꺼짐 · 오른쪽 켜짐)로 구분한다(이전의 "켜짐/꺼짐" 글자 상자는 없앴다). 상태는 접근성 `checked`로도 전달된다.
- 하나만 고르는 값(기본 알림 · 내보내기 기간 · 종류)은 알약(`PillGroup`, 접근성 `radio`)이고, 고른 알약은 진한 테두리 + ✓로 색만으로 구분하지 않는다.
- 탭 화면의 헤더 제목: 홈은 시안처럼 `Voice Life Manager`, 사람은 `가족·친구`. 탭 이름은 홈 · 캘린더 · 지출 · 사람 그대로다.
