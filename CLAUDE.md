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
- **차별화 필요**: 거인과 안 겹치는 틈새(예: 특정 언어/프레임워크 통합, 한국어 알림 채널, 카톡 알림 등)로 좁혀야 함. (아직 미정 — MVP 단계 결정)

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

**PoC 골격 완성 + 스모크 통과.** 동작하는 것:
- check CRUD (생성/조회/일시정지/재개/삭제)
- heartbeat 수신 (success/start/fail)
- 기한초과 자동 DOWN 판정 + 복구 UP 판정
- 알림: 콘솔 로그 + per-check webhook POST
- 대시보드 (목록/생성/상태/액션, 5초 폴링)

**아직 없음 (의도적 — PoC 범위 밖):** 인증/멀티테넌시, 이메일·Slack·카톡 알림, 결제, 알림 재시도/중복억제 정교화, 배포.

다음 할 일은 `ROADMAP.md` 참고.

## 작업 규칙 (이 프로젝트)

- **SQL은 `src/db.js`에만.** 라우트/워커에서 직접 쿼리 금지.
- **외부 입력 검증은 라우트에서** (period/grace 정수, webhook http(s) 등 — 이미 `routes/checks.js`에 패턴 있음).
- **시크릿 하드코딩 금지.** SMTP 등 credential은 `.env`로 (현재 PoC엔 시크릿 없음).
- **단순 우선.** 1인 사이드라 추측성 추상화·미사용 유연성 금지. 기능 추가 전 ROADMAP과 대조.
- 변경 후 `npm run smoke` 통과 확인.
