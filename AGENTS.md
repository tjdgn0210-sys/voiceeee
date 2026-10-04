# Voice Life Manager - Architecture and Engineering Rules

## Authority and scope

- Primary product source: [Korean blueprint v1.1](docs/Voice_Life_Manager_Blueprint_v1.1_KO.pdf).
- Secondary reference: [English blueprint v1.1](docs/Voice_Life_Manager_Blueprint_v1.1_EN.pdf).
- The v5 blueprints in `docs/` describe an earlier scope. Where they conflict with v1.1, v1.1 wins. Keep them as history only.
- The approved product decisions below summarize v1.1 (product-scope rules revised 2026-10-03; technical rules kept). For details, follow the Korean blueprint over the English one. If this file and the blueprint disagree on product scope, stop and ask the app owner; do not guess.
- Items the blueprint marks "확인 필요" (store policies, fees, laws, prices, third-party limits) are unverified. Verify them against current official sources before implementing or releasing; never treat them as facts.
- Preserve React Native, Expo, TypeScript, Expo Router, and SQLite with Android and iOS compatibility. The backend is Supabase (Postgres + RLS, Auth, Storage, Edge Functions) as defined in blueprint chapters 2, 13, and 14.
- These rules define implementation boundaries, not permission to implement features. Work follows milestones M0-M6 in blueprint chapter 18. Implement only the explicitly requested task and stop at its scope.

## Approved product decisions

### 1. NOTE
- Note is part of the MVP domain model.
- It acts as a fallback for information that does not clearly belong to Transaction, Task, or Event.
- Do not create a dedicated Notes tab in the initial MVP.

### 2. AMBIGUOUS TIME
Applies only when the input has no AM/PM cue (오전, 오후, 아침, 저녁, 밤, 새벽, 점심). With a cue, follow it ("저녁 7시" = 19:00).
- Today or no date: use the nearest upcoming time. If the AM time has not passed, use AM; otherwise PM. If the PM time has also passed, do not save; ask "오늘 N시는 이미 지났어요. 내일로 할까요?". If the user says yes, use PM on the next day.
- Later dates: 1-6 means PM (13-18). For 7-11, ask AM or PM. 12 means noon.
- 24-hour expressions (13-23) are used as is. "0시" and "자정" mean 00:00 of the day after the stated date (no date = today, so 00:00 tomorrow). The result card spells out the date (e.g. "10월 4일 0시").
- Expenses (money already spent) go the other way: use the nearest time before now. If that time has not occurred yet today, ask instead of assuming yesterday.
- When the app chose AM/PM automatically, the result card shows "오후 7시로 저장했어요" with [수정].
- The final time is computed by deterministic code in one place (the gateway). The AI only reports whether an AM/PM cue existed (`meridiemExplicit`). Never leave the AM/PM choice to model guessing.
- Fuzzy time such as "저녁쯤" may be stored as fuzzy metadata when no precise reminder is required. If a reminder needs an exact time, ask for it.

### 3. EVENT LIFECYCLE
- Event statuses must distinguish at least:
  upcoming
  past
  completed
  cancelled
- Passing the event time changes it to past, not automatically completed.

### 4. MONEY
- Initial default currency is KRW.
- Store amount as a positive integer.
- EXPENSE / INCOME determines direction.
- Do not encode expenses as negative database amounts.
- Keep a currency_code field so future currencies are possible.
- Bundled expenses: when the user states a total ("총", "합쳐서", "다 해서", "전부 해서", "모두"), save one entry and keep the item names in the memo. Split into separate entries only when every item has an amount and no total is stated. If the item amounts and the stated total disagree, or no amount is given, ask.

### 5. TIME STORAGE
- Persist absolute timestamps in UTC ISO format.
- Display dates/times in the user's local timezone.
- Keep timezone information where necessary for scheduled events/reminders.

### 6. COMPOUND COMMANDS
- ActionProposal supports multiple actions.
- Each action has its own validation and execution state.
- Independent valid actions may execute even if another action requires clarification.
- Dependent actions must wait for their dependency.
- The UI must clearly show which actions succeeded, are pending clarification, or failed.

Example:
"점심 8천원 썼고 내일 민수 만나. 한 시간 전에 알려줘."

The expense may save immediately.
The Event remains pending because time is missing.
The Reminder remains pending because it depends on the Event time.
- One AI call counts once against the user's usage, however many actions it returns.

### 7. UNDO
- Every reversible automatic mutation must create enough evidence to reverse it.
- Show immediate UI Undo after automatic saves.
- Conversation commands such as "방금 거 취소해줘" may target the most recent reversible action.
- Destructive operations outside the safe Undo context require confirmation.
- Saves produced by local parsing or AI are automatic saves with Undo, not confirmation screens.
- Anything that goes to another person (sending an event or expense) always shows a confirmation screen first. An item that has already been sent is cancelled, not undone.

### 8. DUPLICATES / IDEMPOTENCY
- Build idempotency support into Action execution.
- Detect likely rapid duplicate submissions.
- Do not silently discard legitimate repeated transactions.
- Duplicate detection should produce a reviewable result when uncertain.

### 9. CONVERSATION CONTEXT
- MVP context is short-lived.
- Track recent actions and unresolved proposals during the active session.
- Do not persist long-term conversational memory across app restarts in MVP.
- If multiple recent targets match, ask the user instead of guessing.

### 10. OFFLINE
- Local CRUD and local history must work offline.
- Do not silently execute AI-dependent actions later without the user's knowledge.
- If AI processing is unavailable, preserve the text as a pending draft.
- The user can retry processing when connectivity returns.
- Never defer a destructive action for later automatic execution.
- Actions that affect other people (cancelling a sent item, disconnecting or blocking a friend, resets, withdrawal) are disabled while offline, with an explanation.
- Deleting items on the user's own phone (including received items) happens immediately. Only the tombstone for the server goes into the outbox.

### 11. RAW AUDIO
- Raw audio storage is OFF by default.
- Temporary audio may exist only while speech recognition is processing.
- Delete temporary audio after STT finishes or fails.
- Do not retain raw audio merely for debugging.
- Speech recognition runs on the device (ko-KR). If the device cannot do this, turn the voice button off and ask for text input. Do not fall back to server speech recognition.

### 12. REMINDER STATES
Use at least:
- requested
- permission_blocked
- scheduled
- cancelled

Do not claim a reminder was delivered unless the platform provides reliable evidence.
Store both the resolved fire time and enough relationship data to recalculate relative reminders when their Event changes.
- Reminder offsets are signed minutes from the target time: negative = before, 0 = at the time (e.g. 0, -10, -30, -60). The app, the server, server fallback reminders, and `default_reminder_offset` all use this convention.

### 13. AI
- The user approved the Backend R1 scope on 2026-09-30: an authenticated AI gateway, one real OpenAI adapter, and frontend integration. Release 1 extends it per blueprint chapter 14: the multi-action contract v2, per-plan limits and trial counts, and Supabase login tokens instead of the manual pilot token.
- Keep the provider behind the gateway and the mobile interpreter interface. The model is a server setting (`OPENAI_MODEL`, default `gpt-4.1-mini-2025-04-14`), not a client constant. Changing it requires re-running the acceptance tests in blueprint 14.6.
- Local parsing and AI parsing must produce the same ActionProposal contract.
- Calls use strict JSON schema output and `store: false`.
- API keys must never be embedded in the mobile client or committed to the repository.
- The server decides plan, trial, and daily/monthly usage. The app only caches these for display and must not use the cache to allow an action.

### 14. PRIVACY AND DATA OWNERSHIP
- The phone (local SQLite) is the source of truth for personal records. Logged-in users also keep a server backup (Supabase) so that reinstalling restores their data. Guests have no backup.
- raw_input, ActionLog, conversation context, pending drafts, and audio stay on the phone. They are excluded from backup (raw_input is backed up as null).
- Send only the minimum required context to the AI service. Never send the friend list to the AI; match recipients on the phone.
- Friends see only events and tasks the user marked public, through a separate public copy. Expenses are never public. Public items show title, time, and place only.
- Raw audio is never sent anywhere. Speech recognition runs on the device.
- What the app collects and stores must match the list in blueprint 16.1 (the privacy policy source).

### 15. ARCHITECTURE
Enforce this dependency direction:

UI / Features
↓
Application
↓
Domain
↓
Repository interfaces

Adapters and database implementations implement interfaces from inner layers.

Platform-specific code must live behind adapters.

AI must never directly mutate SQLite.

All mutations flow through:

ActionProposal
→ Validator
→ Executor
→ Repository
→ SQLite
→ ActionLog

### 16. DATABASE
- Use migrations for every schema change.
- Use stable UUID-style IDs.
- Use created_at and updated_at on core entities.
- Use soft deletion where recovery/history matters.
- Add indexes only when justified by query patterns.
- Sync, sharing, and backup fields (`origin`, `shared_item_id`, `delivery_id`, `sender_*`, `remote_version`, `visibility`, the outbox, sync state) are defined in blueprint 12.3. Add only what the blueprint or an approved task defines.

### 17. FAILURE
Never report success when persistence, notification scheduling, or another required operation failed.

Preserve enough information for recovery and clearly expose partial success.

### 18. DEVELOPMENT PROCESS
For every task:
- inspect existing relevant code first
- modify only the requested scope
- keep Android and iOS compatibility
- run TypeScript checks (`pnpm typecheck`)
- run lint (`pnpm lint`) and relevant tests (`pnpm test`; `pnpm server:test` for `server/`)
- for backend changes, run an RLS check with another user's token
- check notifications, push, and purchases on real devices; a simulator is not evidence
- report changed files
- report tests performed
- report known limitations
- stop after the requested scope

### 19. OUT OF SCOPE FOR RELEASE 1
Do not implement (blueprint chapter 19):
- in-app chat (excluded)
- recurring events (reconsider in release 2)
- linking "my event" with a sent event (release 1 copies are independent)
- account linking between Apple, Google, and Kakao
- scheduled (future-dated) delivery
- a local rule parser for events (free-tier event voice input)
- merging a guest record with a server backup (the user picks load or overwrite)
- annual billing and store free-trial periods
- a "share via KakaoTalk" button (not requested)
- additional AI providers beyond the approved OpenAI adapter
- external calendar integrations, habits, advanced natural-language search, weekly AI reports, a personalization engine

Cloud backup, friends, sharing, and subscriptions are in scope. Build them only in milestone order (chapter 18) and only when requested.

### 20. TARGET PROJECT STRUCTURE

```text
src/
  domain/
    transaction/
    task/
    event/
    note/
    reminder/
    action/
    sharing/
    friend/

  application/
    proposals/
    validator/
    executor/
    undo/
    sync/
    backup/
    sharing/
    entitlement/

  database/
    migrations/
    repositories/

  adapters/
    speech/
    notifications/
    ai/
    supabase/
    iap/
    export/

  features/
    home/
    capture/
    calendar/
    expense/
    people/
    send/
    inbox/
    settings/
    onboarding/
    paywall/

  components/
  hooks/
  utils/
  types/
```

Existing directories (`app/`, `composition/`, `database/`) stay where they are. The SQLite implementation stays in `database/`; do not move it into `adapters/`.

### 21. ACCOUNTS AND DATA LIFECYCLE
- Login: Apple, Google, Kakao. No email or phone login. Guest start is allowed; login is required for backup, friends, AI, and subscription. Minimum age is 14.
- Nickname: 2-12 characters of Hangul, English letters, digits, or underscore (`^[가-힣A-Za-z0-9_]+$`).
- One account on one device. Logging in on a new device signs the old one out (`DEVICE_REPLACED`), and the old phone clears its local data.
- Guest to login: if the server has no backup, the phone's records become the account's data. If both exist, the user picks "load the server backup" or "overwrite with this phone"; there is no merge. Guest-era items stay private.
- Logout wipes the phone's data after warning about unbacked-up changes. Deleting the app keeps a logged-in user's server backup; a guest's data is gone.
- Keep these actions distinct (blueprint 3.7): disconnect a friend, logout, delete the app, withdraw, and reset (a) one person, (b) all sharing data, (c) phone plus server backup. Withdrawal deletes account data immediately after a two-step confirmation; items already sent stay on recipients' phones, labeled "탈퇴한 사용자".
- Restores and received-item writes go through the repository layer, and the ActionLog records them with a "sync" origin. After a restore, reschedule all future notifications.

### 22. FRIENDS AND SHARING
- Friends are added by a single-use 5-minute invite link, a QR code with the same rules, or an exact nickname search that needs the other side's acceptance. The old friend-code method is removed. Limit: 30 friends. There is no in-app chat.
- Sending requires a subscription (a free member gets one lifetime trial: one event, one recipient). Receiving is free for logged-in users.
- Anything sent to another person goes through a confirmation screen. "Also add to my calendar" creates a separate, independent copy and defaults to off.
- The receiver sets a mode per friend and per type (event, expense): ASK, ALWAYS_ADD, ALWAYS_VIEW, NOT_ALLOWED. The server decides the routed mode. From one sender to one recipient, ALWAYS_ADD items beyond 20 per day (KST) become view-only.
- The sender sees only pending, delivered, expired, or cancelled. Never expose whether the receiver added the item, only viewed it, or has notifications off, in the UI or in the API.
- Sender edits and cancellations apply immediately and show "수정됨". An item the receiver deleted never comes back (tombstones). A pending delivery expires at the event start or after 30 days; the inbox keeps view-only items for 30 days. Delivery is immediate only.
- Each friend can have a display name (alias) that only its owner sees: 1-20 characters, any text, duplicates allowed. It is stored in `friend_links.alias` on the server and cached on the phone, and is used in lists, sources, notifications, Excel export, and voice recipient matching. Show the real nickname in small text beneath it. Never send it to the friend or to the AI. A withdrawn account is labeled "탈퇴한 사용자" everywhere; the alias may remain on the owner's phone but is not used as the label.
- Received items show the sender by looking up `friends_cache.alias` at display time, so alias changes apply immediately. `sender_name` is a last-known-name snapshot, used only when the friend link is disconnected or the friend was deleted and `friends_cache` can no longer resolve the sender. A withdrawn sender always shows "탈퇴한 사용자", never `sender_name`.
- Server fallback reminders (blueprint 13.7) cover only deliveries with `routed_mode = ALWAYS_ADD`. ASK and ALWAYS_VIEW items get none, because the receiver has not added them.
- Public visibility: only events and tasks, per item, and the most restrictive setting wins (blueprint 7.1).

### 23. PLANS AND LIMITS
- Plans: Guest (local only), Free member, Basic KRW 2,900 per month (AI 150 per month and 20 per day; sending 50 per day), Plus KRW 7,900 per month (AI 500 per month and 40 per day; sending 50 per day). Never use the word "unlimited"; state limits as numbers. Daily limits reset at KST midnight. A send counts once per recipient.
- Trial: a free member gets 3 AI interpretations and 1 share, once per account (granted again if the user signs up again).
- The server decides entitlement and usage. Purchases are verified server-side. The app shows cached values only.
- AI deduction (blueprint 4.7): a successful interpretation costs one. Server errors, timeouts, and "cannot interpret" cost none. Follow-up answers within 10 minutes (at most 2 per original request) cost none.
- Prices and limits may change after real token usage is measured. Define each number once; do not scatter copies.

## Architecture enforcement and routing

- Keep `src/app/` as Expo Router route/layout entry points alongside the target structure above. Route components compose feature screens; business rules and persistence must not live in route files.
- `src/features/` and shared UI call application use cases. They must not import concrete database repositories or issue SQL directly.
- Application orchestration depends on domain contracts and inner-layer interfaces, not concrete platform or database implementations.
- Place repository interfaces with the relevant domain under `src/domain/`; implement them in `src/database/repositories/`. Domain code must not depend on React, Expo, SQLite, application, features, or adapters.
- Speech, notification, and AI adapters implement contracts owned by the inner layers. Wire concrete implementations in a composition boundary; do not couple domain rules to platform APIs.
- All user-facing mutations, whether manual, locally parsed, AI proposed, or Undo, use the approved proposal/validation/execution path. Migration SQL is infrastructure work, not a bypass for product mutations.
- Execution evidence must identify per-action outcomes and retain enough reversal data for safe Undo. The pipeline's ActionLog step is required evidence, not permission to report success before required persistence succeeds.
- The folder tree is a target structure. Create directories only when needed by an authorized implementation task; do not create empty scaffolding or move existing starter code merely to match it.
- The production API, scheduling, and storage contracts are defined in blueprint chapters 12-14. Follow them. If a needed decision is missing or marked "확인 필요", ask the app owner or verify against official sources; do not silently invent product policies.
- Authorization is enforced by Supabase RLS and server functions, never by hiding UI. Test every table with another user's token.
- Secrets (the OpenAI key, store credentials, the Supabase service-role key) never reach the client or the repository. `.env` stays untracked.
- Every upload and send request carries a `clientRequestId` so the server can ignore duplicates.

## Expo and repository engineering guidance

This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run TypeScript checks and relevant tests for every task. Run configured lint checks for code changes without automatic fixes unless fixes are in scope. If lint or tests are not configured, report that limitation; do not install dependencies or generate configuration during a documentation-only task. Do not claim a skipped check passed.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
