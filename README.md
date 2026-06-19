# CronWatch

크론잡/배치 작업 생사 감시 (dead man's switch). 작업이 정해진 주기에 ping을 안 보내면 죽은 것으로 보고 알림.

> PoC. 사업 배경·로드맵은 `CLAUDE.md` / `ROADMAP.md` 참고.

## 빠른 시작

```bash
npm install
npm start          # http://localhost:3000
```

대시보드에서 check 생성 → 표시된 **Ping URL**을 크론 스크립트 끝에 붙인다.

```bash
# crontab 예시: 매일 03:00 백업, 성공 시 heartbeat
0 3 * * * /opt/backup.sh && curl -fsS http://localhost:3000/ping/<TOKEN>
```

`period_seconds`(예상 주기) + `grace_seconds`(허용 지연)을 넘기도록 ping이 안 오면 DOWN → 알림.

## API

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/checks` | 목록 |
| POST | `/api/checks` | 생성 `{name, period_seconds, grace_seconds?, webhook_url?}` |
| GET | `/api/checks/:id` | 상세 + 최근 이벤트 |
| POST | `/api/checks/:id/pause` `/resume` | 일시정지/재개 |
| DELETE | `/api/checks/:id` | 삭제 |
| ANY | `/ping/:token` | heartbeat (성공) |
| ANY | `/ping/:token/start` | 작업 시작(정보용) |
| ANY | `/ping/:token/fail` | 명시적 실패 → 즉시 DOWN |

## 검증

```bash
npm run smoke      # create→up→down→recovery E2E. "SMOKE PASS ✅" 확인
```

## 설정

`.env.example` 복사해 `.env` 생성 (PoC는 없어도 기본값 동작). `PORT`, `BASE_URL`, `WORKER_INTERVAL_SECONDS`, `DB_PATH`.
