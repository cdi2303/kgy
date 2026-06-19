# 배포 가이드 (Railway, Stage 1)

Stage 1 목표 = **공개 랜딩 + 대기자 수집**. 프로덕션은 `LANDING_ONLY=true`로
랜딩/waitlist만 띄우고 미인증 checks API·SSRF 위험·워커는 끈다.

## 왜 Railway
- 모니터링 서비스라 워커가 24/7 떠 있어야 함 + SQLite 영구 디스크 필요.
- Vercel/Netlify(서버리스), Render 무료(idle 스핀다운)는 부적합.
- Railway = always-on + 볼륨 + git/CLI 배포로 1인 운영에 가장 쉬움.

## 사전 준비
- Railway 계정 (https://railway.app, GitHub 로그인)
- Node/npm (로컬에 이미 있음)

## 배포 단계

> `railway login`은 브라우저 인증이라 **직접** 실행해야 함.
> Claude 세션이면 프롬프트에 `!railway login` 쳐서 실행 가능.

```bash
# 1. CLI 설치
npm i -g @railway/cli

# 2. 로그인 (브라우저 열림 — 직접 실행)
railway login

# 3. 프로젝트 생성 + 현재 폴더 연결
cd C:\Users\carelabs\Desktop\kgy
railway init          # 프로젝트 이름 입력 (예: cronwatch)

# 4. 환경변수 설정 (PORT는 Railway가 자동 주입 — 설정 금지)
railway variables --set LANDING_ONLY=true --set DB_PATH=/data/cronwatch.sqlite

# 5. 영구 볼륨 추가 — SQLite 저장용
#    CLI 버전에 따라 다름. 안 되면 대시보드에서:
#    Railway 대시보드 > 서비스 > Variables 옆 "Volumes" > New Volume
#    Mount path = /data   (DB_PATH와 일치해야 함)
railway volume add --mount-path /data   # 미지원 버전이면 위 대시보드 방법

# 6. 배포 (현재 디렉토리 업로드 + 빌드)
railway up

# 7. 공개 URL 발급
railway domain        # *.up.railway.app URL 생성/출력
```

## 배포 후 확인
- 발급된 URL 접속 → 랜딩 보임
- 이메일 등록 → "등록 완료" → 새로고침 시 가입자 수 증가
- `URL/app`, `URL/api/checks` → **404 정상** (LANDING_ONLY로 차단됨)
- `URL/health` → `{"ok":true}`

## 주의
- **볼륨 Mount path = `DB_PATH`** 와 반드시 일치(`/data`). 안 그러면 재배포마다 대기자 데이터 날아감.
- 대기자 이메일 = 개인정보. 볼륨에만 저장되고 API로 조회 불가(목록 엔드포인트 없음, count만 공개).
- 비용: 트라이얼 크레딧 소진 후 ~$5/월(Hobby).

## Stage 2 진입 시 (참고)
풀 제품 공개하려면 `LANDING_ONLY` 해제 전에: 인증/멀티테넌시, SSRF 가드(webhook 사설IP 차단),
레이트리밋 먼저. ROADMAP Stage 2/3 참고.
