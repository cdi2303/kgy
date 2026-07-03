# CronWatch Roadmap

단계별 진행. 각 단계는 **검증 가능한 완료 기준**을 가진다. 작업 시작 전 여기서 현재 위치 확인.

---

## ✅ Stage 0 — PoC 골격 (완료, 2026-06-19)

- [x] 프로젝트 구조 + 의존성 (express, better-sqlite3)
- [x] 데이터 모델 (checks, events) — `src/db.js`
- [x] check CRUD API — `src/routes/checks.js`
- [x] heartbeat 수신 (success/start/fail) — `src/routes/ping.js`
- [x] 기한초과 판정 워커 (DOWN) + 복구(UP) — `src/worker.js`
- [x] 알림: 콘솔 + webhook — `src/notify.js`
- [x] 대시보드 — `public/index.html`
- [x] E2E 스모크 테스트 — `scripts/smoke.js`

**완료 기준**: `npm run smoke` → `SMOKE PASS ✅`. ✔ 충족.

---

## 🔄 Stage 1 — 시장 검증 / 틈새 확정 (진행 중)

코드 더 짜기 전에 **누구에게 팔지** 좁혀야 함. 안 그러면 거인(Healthchecks/Cronitor)과 정면충돌.

- [x] **틈새 확정 (2026-06-19)**: 한국시장 + **카카오톡 네이티브 알림** 크론 감시.
      헤드라인 = **알림톡**(개인 카톡, DIY 어려움 → moat 두꺼움) + 카카오워크(팀).
      경쟁사(Healthchecks/Cronitor/DMS) 전부 Slack/Telegram 중심, 카톡 연동 0.
- [x] **랜딩페이지 + 대기자 수집** — `public/landing.html` + `/api/waitlist`. 동작 확인(smoke).
- [x] **가격 가설**: Free 3 checks / ₩5,900 20 checks / ₩19,000 무제한+알림톡.
- [x] **랜딩 배포 (2026-06-19)**: Railway. 라이브 → **https://cronwatch-production.up.railway.app** (LANDING_ONLY=true).
- [x] **GTM 플레이북 작성 (2026-06-19)**: 채널전략·포스트초안·검증질문·Go/No-Go → `GTM.md` (근거: GeekNews 규범·Mom Test·HN 런치 정석).
- [ ] **트래픽 유입**: `GTM.md` 포스트 본인 목소리로 다듬어 한국 채널(GeekNews부터) 게시. 게시는 본인이.
- [ ] **검증 인터뷰**: 가입자에게 Mom Test 5질문(`GTM.md` §3).
- [ ] **Go/No-Go 판정**: `GTM.md` §4 기준 — 가입 수 아닌 신호의 질로.

**완료 기준**: 타깃 고객 1문장 정의 ✔ + 유료 의사 5명 이상 신호(미달성).
**남은 건 코드 아님 — 배포 + 마케팅 + 대화.**

---

## ⏭ Stage 2 — MVP (팔 수 있는 최소형)

- [ ] **인증 + 멀티테넌시**: 사용자별 check 격리 (현재 전역). user_id 컬럼 + 세션/토큰 인증.
- [ ] **이메일 알림** (SMTP) — webhook보다 기본 채널. `notify.js` 확장.
- [ ] **카카오 알림 채널** — `ALIMTALK.md` 기술검토 완료. 순서: 카카오워크 webhook(즉시) → 알림톡(템플릿 **심사 통과 검증 먼저**, Solapi). ⚠️ 알림톡 정보성 심사 리스크가 차별화의 최대 변수.
- [x] **알림 정책 (2026-07-03)**: down 지속 시 `REALERT_INTERVAL_SECONDS`(기본 1h)당 최대 1회 재알림, 복구 알림은 1회만. `checks.last_alert_at`로 추적, smoke 검증.
- [ ] **결제** (Stripe/토스페이먼츠 등) + 플랜별 check 수 제한.
- [x] 대시보드: check 상세(이벤트 타임라인), 가동률 표시. (2026-07-03) 이름 클릭→상세 패널. down/up 전환을 events에 기록, `uptime_7d` 계산.

**완료 기준**: 외부 사용자가 가입→check 생성→실제 알림 수신→결제까지 가능.

---

## ⏭ Stage 3 — 운영 견고화

- [ ] 배포 (단일 VPS + 프로세스 매니저, 또는 컨테이너). HTTPS.
- [x] DB 백업 (2026-07-03): `/api/admin/backup`(토큰 보호, SQLite 스냅샷) + GH Actions 매일 03:17 KST 암호화 아티팩트 30일 보관. 복원법은 `backup.yml` 주석. (Postgres 검토는 규모 시)
- [ ] 워커 신뢰성: 서버 재시작 후에도 판정 일관, 다중 인스턴스 시 중복 알림 방지.
- [x] 자기 서비스 감시 — dogfooding (2026-07-03): GH Actions `selfcheck` 10분마다 `/health`+ping. 완전 사망=워크플로 실패→GitHub 이메일(외부 알람), 부분 장애=자체 워커 알림. (로깅/모니터링 일반화는 추후).
- [ ] 사용량 지표 (활성 check, 알림 발송 수).

**완료 기준**: 1주 무중단 운영 + 유료 고객 첫 결제.

---

## 의사결정 로그

- **2026-06-19**: 스택 Node+Express+SQLite 확정 (1인 운영 마찰 최소). PHP/CI4 배제.
- **2026-06-19**: PoC는 인증·결제 제외, 핵심 감시 루프만 검증 (범위 통제).
- **미정**: 틈새 시장 (Stage 1에서 결정). 알림 기본 채널(이메일) vs 차별화 채널(카톡).
