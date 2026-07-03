# CronWatch — Claude Context

> 이 파일은 **새 Claude 세션이 이어서 작업**하기 위한 컨텍스트다.
> 폴더(`kgy`)를 열고 새 세션 시작하면 이 파일을 먼저 읽고 현재 상태부터 파악할 것.

## 한 줄 요약

크론잡/배치 작업 **death man's switch(생사 감시)** SaaS. 크론이 실행될 때마다 고유 URL에 ping →
기한 내 ping 없으면 "죽은 것"으로 판정 → 알림. 1인 사이드 프로젝트, 월 구독 SaaS 목표.
경쟁/참고: Healthchecks.io, Cronitor, Dead Man's Snitch.

## 왜 이걸 만드나 (사업 가설)

- **누가 돈 내나**: 개발자·소규모 팀. 야간 배치/백업/크론이 조용히 죽으면 며칠 뒤에야 발견 → 사고.
- **왜 구독 유지**: 감시는 "끊기면 사고" → 해지율 낮음. 100% 자동(서버가 판정) → CS 최소 → 1인 운영 가능.
- **틈새 확정 (2026-06-19)**: 한국시장 + **카카오톡 네이티브 알림**. 헤드라인 = 알림톡(개인 카톡, DIY 어려워 moat 두꺼움) + 카카오워크(팀). 경쟁사(Healthchecks/Cronitor/DMS) 전부 Slack/Telegram 중심이라 카톡 연동 0 → 갭.

## 기술 스택 (결정 사항)

- **런타임**: Node.js 20 (CommonJS). 단일 언어, Windows 친화, zero-config.
- **웹**: Express 4.
- **DB**: SQLite (`better-sqlite3`, 동기 API). 모든 SQL은 `src/db.js`에만. → 나중에 Postgres 교체 쉽게 격리.
- **프론트**: 정적 `public/index.html` + vanilla JS (빌드 도구 없음).
- **외부 의존성 최소**: deps = express, better-sqlite3 둘뿐.

이유: 1인 사이드라 운영·빌드 마찰 최소가 1순위. PHP/CI4(다른 회사 프로젝트 스택)는 micro-SaaS엔 무거워서 채택 안 함.

## 핵심 동작 (death man's switch)

1. 사용자가 check(모니터) 생성: `name`, `period_seconds`(예상 ping 주기), `grace_seconds`(허용 지연), 선택 `webhook_url`.
2. 생성 시 고유 `ping_token` 발급 → ping URL = `BASE_URL/ping/{token}`.
3. 크론 스크립트 끝에 `curl {ping_url}` 한 줄 추가 → 실행될 때마다 heartbeat.
4. **워커**(`src/worker.js`)가 주기적으로(기본 15s) 스캔:
   - `deadline = (last_ping_at ?? created_at) + (period + grace) * 1000`
   - `now > deadline` 이고 `status != down` → **DOWN 전환 + 알림**.
5. ping이 다시 들어오면(`routes/ping.js`): `up`으로 복귀, 직전이 down이었으면 **복구 알림**.

상태값: `new`(생성 후 첫 ping 전) / `up` / `down` / `paused`.
ping 종류: `/ping/{token}`(=success), `/ping/{token}/start`(정보용), `/ping/{token}/fail`(즉시 down).

## 파일 맵

```
kgy/
├── CLAUDE.md            ← 이 파일 (세션 컨텍스트)
├── README.md            ← 사람용 사용법
├── ROADMAP.md           ← PoC→MVP 단계 + 진행 체크리스트 (작업 시작 전 여기 확인)
├── package.json         ← deps + scripts (start/dev/smoke)
├── .env.example         ← 설정 항목 (PoC는 .env 없어도 기본값으로 동작)
├── public/index.html    ← 대시보드 (단일 HTML, 5초마다 폴링)
├── scripts/smoke.js     ← E2E 스모크 테스트 (create→up→down→recovery)
└── src/
    ├── config.js        ← env 로딩 + 기본값
    ├── db.js            ← SQLite 스키마 + 모든 쿼리 (여기 외엔 SQL 금지)
    ├── notify.js        ← 알림 채널 (현재: console + webhook). 이메일/Slack은 TODO
    ├── worker.js        ← 기한초과 판정 워커 (핵심 로직)
    ├── server.js        ← 진입점, Express 와이어링
    └── routes/
        ├── checks.js    ← check CRUD API (/api/checks)
        └── ping.js      ← heartbeat 수신 (/ping/:token)
```

## 데이터 모델 (`src/db.js`)

- `checks`: id, name, ping_token(unique), period_seconds, grace_seconds, status, last_ping_at(ms), webhook_url, created_at
- `events`: id, check_id(FK), type(success|start|fail), received_at, source_ip

## 실행 / 검증

```bash
npm install        # better-sqlite3 prebuilt (Windows x64 동작 확인됨)
npm start          # http://localhost:3000 — 대시보드 + API + 워커
npm run smoke      # E2E 검증 (격리 DB, 빠른 워커). "SMOKE PASS ✅" 떠야 정상
```

크론 연동 예: `0 3 * * * /backup.sh && curl -fsS http://localhost:3000/ping/{token}`

## 현재 상태 (2026-06-19)

**PoC 골격 + Stage1 랜딩 완성, 스모크 통과.** 동작하는 것:
- check CRUD (생성/조회/일시정지/재개/삭제)
- heartbeat 수신 (success/start/fail)
- 기한초과 자동 DOWN 판정 + 복구 UP 판정
- 알림: 콘솔 로그 + per-check webhook POST. **카카오워크 어댑터**: webhook URL 호스트가 `*.kakaowork.com`이면 `{text}` 채팅 포맷 발송(위장 호스트 거부), 그 외 generic payload. (승인 불필요라 선구현)
- **라우팅**: `/` = 랜딩(대기자 수집), `/app` = 대시보드
- **랜딩 + 대기자 수집**: `public/landing.html`(OG/트위터 메타+파비콘=공유 미리보기) + `/api/waitlist`(POST 등록/dedupe, GET /count)
- **검증 지표**: 랜딩 GET마다 `landing_views` 카운트, `GET /api/stats` → {views, signups, conversion}. PII·외부추적기 없음. (봇/새로고침 포함 rough)
- **채널 출처**: 랜딩 `?ref=`/`utm_source` → 가입 `source`에 `{ref}:{form}` 기록. 채널별 링크는 `GTM.md §4-1`.
- **레이트리밋**: `POST /api/waitlist` IP당 10건/10분(`src/ratelimit.js`, 인메모리·단일인스턴스). 검증 데이터 스팸 보호.
- **어드민 신호 뷰**: `/admin`(페이지) + `GET /api/admin/signal`(`src/routes/admin.js`). 토큰(`ADMIN_TOKEN` env) 보호, 미설정 시 404. 방문/가입/전환+채널별+최근가입(이메일 마스킹). 토큰은 Railway 변수, 코드 하드코딩 금지. 신호 확인법은 `RUNBOOK.md` 상단.
- **가입 알림(owner)**: 새 가입 시 `notify.notifyOwner` → **Telegram**(`TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHAT_ID`, 우선) 또는 `{text}` webhook(`SIGNUP_ALERT_WEBHOOK`, 카카오워크/Slack). 다 미설정=무동작. 이메일 마스킹. 가입자 빠른 인터뷰용 계측. (카카오워크는 확장 탭 관리자/플랜 게이트로 막혀 Telegram 채택.)
- **`LANDING_ONLY=true`**: 프로덕션 배포용. 랜딩+waitlist만 노출, checks/ping/`/app`/워커 차단(미인증 API·SSRF 표면 제거). 로컬은 미설정=풀앱. 배포는 `DEPLOY.md`(Railway) 참고.

**아직 없음 (의도적 — 범위 밖):** 인증/멀티테넌시, 이메일·Slack·**카톡** 실제 발송, 결제, 알림 중복억제 정교화, 배포.

**배포됨:** Railway 라이브 → **https://cronwatch-production.up.railway.app**
- **2026-07-03: `LANDING_ONLY=false` 플립 → 풀 제품 공개** (랜딩 + `/app` 인증/감시 + ping + 워커 + 이메일). 검증: `/health` 200, `/app` 200, `/api/checks` 401, ping 라우트/워커 동작.
- (그 전 어느 시점 서비스 Failed로 죽어 있었음 — 2026-07-03 재배포로 복구. 원인 로그 없음.)
- 프로젝트 `cronwatch` (cdi2303's Projects), 서비스 `cronwatch`, 볼륨 `/data`(SQLite 영구저장).
- 재배포: `kgy`에서 `railway up --detach` (이미 링크됨). 상태: `railway status`. 로그: `railway logs` / `railway logs --build`.
- 프로덕션 변수: `LANDING_ONLY=true`, `DB_PATH=/data/cronwatch.sqlite`, `NIXPACKS_NODE_VERSION=20`.
- ⚠️ **Node 20 핀 유지** (`.nvmrc`, engines): better-sqlite3 prebuilt용. Node 24+면 소스빌드 실패.
- 로컬(macOS, 2026-07-03~): 시스템 Node 26이라 실패 → `brew install node@20` 후 `export PATH="/opt/homebrew/opt/node@20/bin:$PATH"`로 npm 실행. (이 폴더는 Windows→macOS 이전됨; node_modules 재설치 완료.)
- ⚠️ Git Bash에서 `/data` 같은 경로 인자는 `MSYS_NO_PATHCONV=1` 안 붙이면 Windows 경로로 변환됨.
- waitlist/stats = **0으로 초기화됨(2026-06-22)**, 깨끗한 출시 상태. (검증 중 쌓인 테스트 데이터는 볼륨 재생성으로 제거.)
- 프로덕션 데이터 wipe 방법: `railway volume delete --volume cronwatch-volume --yes` → `MSYS_NO_PATHCONV=1 railway volume add --mount-path /data` → `railway up --detach`. (볼륨 *파일* 단위 접근/`railway ssh`는 SSH 키 등록 필요 — 대시보드에서.)

**Stage 1 자산:** `GTM.md`(채널·포스트·검증질문·Go/No-Go), `RUNBOOK.md`(시나리오별 행동 트리), `ALIMTALK.md`(카톡 발송 기술검토).
**다음 (ROADMAP Stage 1 잔여 — 코드 아님):** 트래픽 유입(GTM.md, 게시는 본인) → 검증 인터뷰 → 신호 확인 후 Stage 2.
**Stage 2 핵심 변수:** 알림톡 정보성 심사 통과 여부(ALIMTALK.md). 코드보다 심사 검증 먼저.

## Stage 2 (빌드 중 — 2026-06-22~)
- **인증/세션**: `src/auth.js`(scrypt 해싱 + 쿠키 세션, DB-backed), `src/routes/auth.js`(register/login/logout/me). users·sessions 테이블.
- **멀티테넌시**: checks에 `user_id`, 모든 check 쿼리 유저 스코프. `/api/checks`는 `requireAuth` 뒤. 교차 테넌트 차단(smoke 검증).
- **플랜 한도**: free 3 / pro 20 / team 무제한 (`routes/checks.js` PLAN_LIMITS). 초과 시 402.
- **대시보드**: `/app` = 로그인/회원가입 게이트 + 유저별 체크. 비로그인 시 인증화면.
- **SSRF 가드**: `src/ssrf.js` — 유저 webhook_url을 사설/루프백/링크로컬/메타데이터로 못 쏘게 차단(`notify.fireUserWebhook`, redirect:manual). owner 알림(env, 신뢰)은 `fireWebhook` 직접. smoke 검증.
- **이메일 알림**: `notify.sendEmail`. **Railway는 SMTP 포트(25/587) 아웃바운드 차단** → SMTP는 Connection timeout. 그래서 **Resend HTTP API(443) 우선** 사용: `RESEND_API_KEY`(+`EMAIL_FROM`, 기본 onboarding@resend.dev, `RESEND_API_BASE` 테스트 오버라이드). SMTP(`SMTP_*`)는 Railway 외 호스트용 폴백. 체크 down/up 시 owner 이메일. 미설정=무동작. Resend 무도메인 시 from=onboarding@resend.dev + 본인 가입메일로만 발송(임의 수신자는 도메인 인증 필요).
- **product 노출**: 랜딩 nav에 `/app` 로그인 링크. 프로덕션 `LANDING_ONLY` 플립 시 풀 제품(인증+감시+이메일) 공개 — SSRF 가드 있어 안전.
- **알림 정책 (2026-07-03)**: down 지속 시 워커가 `REALERT_INTERVAL_SECONDS`(기본 3600, 0=끔)당 최대 1회 재알림(이메일 제목 "여전히 다운", generic webhook payload에 `repeat` 플래그). `checks.last_alert_at` 컬럼(마이그레이션)으로 추적, down 전환/fail ping 시 스탬프. 복구 알림은 1회. smoke §15 검증.
- **check 상세 (2026-07-03)**: down/up **전환도 events에 기록**(worker/ping.js, type=`down`/`up` — ping 종류 success/start/fail과 구분). `GET /api/checks/:id` → `uptime_7d`(전환 이벤트 워크, 미기록 구간=up 가정) + events 50건. 대시보드에서 이름 클릭 → 상세 패널(가동률·타임라인). smoke §5 검증.
- **남은 외부게이트**: 알림톡(Solapi키+**카카오 템플릿 심사**), 결제(PG 가맹키). 둘 다 네 사업자/계약 필요 — 키/승인 들어오면 빌드.

## CI
- GitHub Actions(`.github/workflows/ci.yml`): push(main)/PR마다 Node 20 + `npm ci` + `npm run smoke`. 초록 유지.
- **Dogfooding**(`.github/workflows/selfcheck.yml`, 2026-07-03): 10분 cron으로 프로덕션 `/health` → 성공 시 `cronwatch-selfcheck` 체크(주기 600s/여유 1800s)에 ping. health 실패=워크플로 실패→GitHub 이메일(완전 사망용 외부 알람). ping URL은 GH secret `SELFCHECK_PING_URL`(repo public이라 비공개 필수). 계정: cdi2303@gmail.com(Resend 수신 가능 주소).

## 작업 규칙 (이 프로젝트)

- **SQL은 `src/db.js`에만.** 라우트/워커에서 직접 쿼리 금지.
- **외부 입력 검증은 라우트에서** (period/grace 정수, webhook http(s) 등 — 이미 `routes/checks.js`에 패턴 있음).
- **시크릿 하드코딩 금지.** SMTP 등 credential은 `.env`로 (현재 PoC엔 시크릿 없음).
- **단순 우선.** 1인 사이드라 추측성 추상화·미사용 유연성 금지. 기능 추가 전 ROADMAP과 대조.
- 변경 후 `npm run smoke` 통과 확인.
