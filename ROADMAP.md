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

## ⏭ Stage 1 — 시장 검증 / 틈새 확정 (코드 아님, 먼저 할 것)

코드 더 짜기 전에 **누구에게 팔지** 좁혀야 함. 안 그러면 거인(Healthchecks/Cronitor)과 정면충돌.

- [ ] 틈새 1개 선택. 후보:
  - 한국 개발자/팀 + **카카오톡 알림** (영어권 경쟁사가 안 하는 채널)
  - 특정 스택 통합 (예: Laravel/Django scheduler, GitHub Actions, n8n)
  - 비개발 운영팀용 "사람이 읽는" 리포트형
- [ ] 랜딩페이지 + 대기자 수집 → 수요 신호 확인
- [ ] 가격 가설 (예: free 3 checks / $5 20 checks / $19 무제한)

**완료 기준**: 타깃 고객 1문장 정의 + 유료 의사 5명 이상 신호.

---

## ⏭ Stage 2 — MVP (팔 수 있는 최소형)

- [ ] **인증 + 멀티테넌시**: 사용자별 check 격리 (현재 전역). user_id 컬럼 + 세션/토큰 인증.
- [ ] **이메일 알림** (SMTP) — webhook보다 기본 채널. `notify.js` 확장.
- [ ] **선택 틈새 채널** (예: 카카오톡/Slack/Telegram).
- [ ] **알림 정책**: 중복 억제(이미 down이면 재알림 주기 제한), down 후 재시도.
- [ ] **결제** (Stripe/토스페이먼츠 등) + 플랜별 check 수 제한.
- [ ] 대시보드: check 상세(이벤트 타임라인), 가동률 표시.

**완료 기준**: 외부 사용자가 가입→check 생성→실제 알림 수신→결제까지 가능.

---

## ⏭ Stage 3 — 운영 견고화

- [ ] 배포 (단일 VPS + 프로세스 매니저, 또는 컨테이너). HTTPS.
- [ ] DB 백업 / SQLite→Postgres 검토 (동시성·규모 시).
- [ ] 워커 신뢰성: 서버 재시작 후에도 판정 일관, 다중 인스턴스 시 중복 알림 방지.
- [ ] 로깅/모니터링 (자기 서비스도 감시 — dogfooding).
- [ ] 사용량 지표 (활성 check, 알림 발송 수).

**완료 기준**: 1주 무중단 운영 + 유료 고객 첫 결제.

---

## 의사결정 로그

- **2026-06-19**: 스택 Node+Express+SQLite 확정 (1인 운영 마찰 최소). PHP/CI4 배제.
- **2026-06-19**: PoC는 인증·결제 제외, 핵심 감시 루프만 검증 (범위 통제).
- **미정**: 틈새 시장 (Stage 1에서 결정). 알림 기본 채널(이메일) vs 차별화 채널(카톡).
