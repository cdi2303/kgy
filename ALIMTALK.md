# 카카오톡 알림 발송 — 기술 검토 (Stage 2 준비)

차별화 핵심 = "배치 죽으면 카톡으로". 이 문서는 **실제 발송이 가능한가/어떻게/리스크**를 근거 기반으로 정리.
결론 먼저: **카카오워크(팀)는 즉시 가능, 알림톡(개인)은 가능하나 심사 리스크가 최대 변수**.

---

## 0. 채널 두 갈래

| 채널 | 대상 | 승인 | 비용 | 난이도 | moat |
|---|---|---|---|---|---|
| **카카오워크 Incoming Webhook** | 팀(카카오워크 사용처) | 불필요 | 무료 | 낮음(기존 webhook 구조) | 얇음(누구나 배선) |
| **알림톡(AlimTalk)** | 개인 카톡 전체 | **템플릿 심사 필요** | 건당 ~8원 | 중(대행사 연동) | **두꺼움(DIY 어려움)** |

> 근거: 카카오워크 webhook 무료/즉시 — https://blog.kakaowork.com/226 ·
> 알림톡 단가/연동 — https://solapi.com/pricing

---

## 1. 카카오워크 webhook — 즉시 가능

연동: 카카오워크 확장서비스 → Incoming Webhook → Bot 생성 → 채팅방 선택 → Webhook URL 발급 → 그 URL로 JSON POST.

**우리 코드 영향**: 거의 없음. `src/notify.js`가 이미 per-check `webhook_url`로 POST 중.
단, 카카오워크는 **고유 payload 포맷**(예: `{ "text": "..." }` 형태)을 기대 → 현재 우리 payload(`{event,check_id,...}`)는 메시지로 안 보임.
→ **카카오워크 전용 어댑터**(상태→텍스트 변환)만 추가하면 됨. 작은 작업.

```js
// notify.js에 추가될 형태 (설계만)
function kakaoworkText(check, state){
  return state === 'down'
    ? `⛔ [${check.name}] 신호 끊김 — 배치 점검 필요`
    : `✅ [${check.name}] 정상 복구`;
}
// webhook이 카카오워크 URL이면 { text } 로 감싸 POST
```

> ⚠️ 카카오워크 정확한 payload 스키마는 발급 시 문서 확인 필요(텍스트/블록 형식). 연동 시 확정.

---

## 2. 알림톡 — 가능하나 심사가 최대 변수

### 발송까지 단계 (근거: 카카오 비즈니스 가이드)
1. **카카오 비즈니스 채널** 개설 + **발신프로필** 등록(대행사 통해).
2. **템플릿 사전 등록 + 심사**. 카카오가 정보통신망법·내부기준으로 검수. 영업일 소요.
3. 승인된 템플릿으로만 발송(변수만 치환 가능, 자유 문구 불가).

> 근거: 알림톡 템플릿은 검수를 거쳐야 발송 가능 — https://kakaobusiness.gitbook.io/main/ad/infotalk/audit

### ⚠️ 핵심 리스크 — "정보성" 통과 여부
알림톡은 **정보성 메시지만** 허용. 정의 = **"고객의 선행 행동 + 기업의 결과 피드백"**
(예: 주문→주문완료, 결제→결제내역). 뉴스레터·공지·홍보는 불가, 포함 시 발송 차단.

- 우리 알림 = "사용자가 등록한 체크의 상태 변화(다운/복구) 통보".
- 프레이밍: "사용자 선행행동(체크 등록) → 결과 피드백(상태 변화 알림)" → **정보성 논리로 성립 가능**.
- 그러나 **심사 통과는 불확실**. 통과 못 하면 개인 카톡(차별화 핵심)이 막힌다.

→ **결론: 코드 구현보다 템플릿 1건 심사 통과 검증이 먼저.**
   Stage 2 착수 시 ① 비즈채널 개설 ② "[OOO] 모니터링 상태 알림" 템플릿 1건 등록 ③ 심사 결과 확인.
   심사 통과 = 차별화 검증됨 → 그때 코드. 반려 = SMS/카카오워크로 대체 전략 재검토.

### 대행사 선택 (근거 기반)
| 대행사 | 적합성 | 근거 |
|---|---|---|
| **Solapi** ✅추천 | 월정액 무료·건당 8원·클라우드 OK·Node SDK·개발자 친화 | https://solapi.com/developers , https://solapi.com/pricing |
| NCloud SENS | 알림톡+SMS failover, 클라우드 친화 | https://www.ncloud.com/product/applicationService/sens |
| Aligo | 최저가지만 **고정 IP 등록 필수 → Railway 동적IP 불가** | 클라우드 환경 사용 제약 |

→ **Solapi**: Railway 같은 클라우드에서 동작 + 종량제라 사이드에 맞음. SMS failover 원하면 SENS.

---

## 3. notify.js 통합 설계 (Stage 2, 코드는 아직 안 함)

현재 `notify.js`는 `alert(check, state)` 하나. 채널 추가 시 채널 배열로 확장:

```
alert(check, state)
  ├─ email(check, state)            // SMTP — 기본 채널 (Stage 2)
  ├─ kakaowork(check, state)        // webhook { text } — 승인 불필요, 먼저
  └─ alimtalk(check, state)         // Solapi SDK — 심사 통과 후
```

- 채널 활성화는 check별 설정(예: `notify_channels` 컬럼)으로.
- **크레덴셜(Solapi API key/secret, SMTP)** 은 `.env`로만. 코드 하드코딩 금지. Railway 변수로 주입.
- 알림톡 실패 시 SMS/이메일 failover 고려.

---

## 4. 권장 순서 (근거 종합)

1. **Stage 2-a (즉시군)**: 이메일(SMTP) + 카카오워크 webhook. 승인 0, 팀 고객 대상 가치 즉시.
2. **Stage 2-b (검증 선행)**: 알림톡 — **비즈채널+템플릿 심사부터**. 통과 확인 후 Solapi 연동.
3. 심사 반려 시: 개인 카톡 차별화 약화 → SMS(종량) + 카카오워크로 포지셔닝 조정.

**지금 당장 코드 안 하는 이유**: Stage 1 수요 신호 미확보 + 알림톡 심사 리스크 미해소 + 크레덴셜 미보유.
신호 확인 → 심사 통과 → 그때 구현이 순서(Simplicity/Goal-driven).
