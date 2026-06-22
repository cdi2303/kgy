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
- **`LANDING_ONLY=true`**: 프로덕션 배포용. 랜딩+waitlist만 노출, checks/ping/`/app`/워커 차단(미인증 API·SSRF 표면 제거). 로컬은 미설정=풀앱. 배포는 `DEPLOY.md`(Railway) 참고.

**아직 없음 (의도적 — 범위 밖):** 인증/멀티테넌시, 이메일·Slack·**카톡** 실제 발송, 결제, 알림 중복억제 정교화, 배포.

**배포됨 (2026-06-19):** Railway 라이브 → **https://cronwatch-production.up.railway.app** (LANDING_ONLY=true, 랜딩+waitlist만).
- 프로젝트 `cronwatch` (cdi2303's Projects), 서비스 `cronwatch`, 볼륨 `/data`(SQLite 영구저장).
- 재배포: `kgy`에서 `railway up --detach` (이미 링크됨). 상태: `railway status`. 로그: `railway logs` / `railway logs --build`.
- 프로덕션 변수: `LANDING_ONLY=true`, `DB_PATH=/data/cronwatch.sqlite`, `NIXPACKS_NODE_VERSION=20`.
- ⚠️ **Node 20 핀 유지** (`.nvmrc`, engines): better-sqlite3 prebuilt용. Node 24면 소스빌드→Python 없어 빌드 실패.
- ⚠️ Git Bash에서 `/data` 같은 경로 인자는 `MSYS_NO_PATHCONV=1` 안 붙이면 Windows 경로로 변환됨.
- 현재 waitlist에 테스트 행 1개 있음(배포 검증용). 정리하려면 Railway 대시보드에서 SSH 키 등록 후 삭제, 또는 무시.

**Stage 1 자산:** `GTM.md`(채널·포스트·검증질문·Go/No-Go, 근거 기반), `ALIMTALK.md`(카톡 발송 기술검토).
**다음 (ROADMAP Stage 1 잔여 — 코드 아님):** 트래픽 유입(GTM.md, 게시는 본인) → 검증 인터뷰 → 신호 확인 후 Stage 2.
**Stage 2 핵심 변수:** 알림톡 정보성 심사 통과 여부(ALIMTALK.md). 코드보다 심사 검증 먼저.

## 작업 규칙 (이 프로젝트)

- **SQL은 `src/db.js`에만.** 라우트/워커에서 직접 쿼리 금지.
- **외부 입력 검증은 라우트에서** (period/grace 정수, webhook http(s) 등 — 이미 `routes/checks.js`에 패턴 있음).
- **시크릿 하드코딩 금지.** SMTP 등 credential은 `.env`로 (현재 PoC엔 시크릿 없음).
- **단순 우선.** 1인 사이드라 추측성 추상화·미사용 유연성 금지. 기능 추가 전 ROADMAP과 대조.
- 변경 후 `npm run smoke` 통과 확인.
