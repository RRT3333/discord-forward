# 이메일 알림 운영 런북 (직원용)

이 문서는 Cloudflare Worker + Discord Webhook 기반 이메일 알림 시스템을 팀에서 안정적으로 운영하기 위한 실무 가이드입니다.

## 1) 이 시스템이 하는 일

- 수신 이메일을 감지합니다.
- 메타데이터(보낸사람, 받는주소, 제목)를 Discord에 먼저 전송합니다.
- 본문은 길이에 따라 단건/분할/첨부 방식으로 전송합니다.
- 필요 시 백업 이메일 주소로도 포워딩합니다.

## 2) wrangler 시작하기 (처음 설정)

사전 조건:
- Node.js 18 이상
- Cloudflare 계정 접근 권한
- 이 저장소 접근 권한

최초 1회:
1. 의존성 설치
   - npm install
2. Cloudflare 로그인
   - npx wrangler login
3. 프로젝트 확인
   - npx wrangler whoami

로컬 개발 실행:
- npm run dev

배포:
- npm run deploy

참고:
- 이 프로젝트는 wrangler.toml 대신 wrangler.jsonc를 사용합니다.

## 3) 필수 시크릿 설정

중요: 웹훅 URL, 실사용 주소는 코드에 직접 넣지 않습니다.

필수/선택 시크릿:
- DISCORD_WEBHOOK_URL (필수)
- BACKUP_FORWARD_TO (선택)

설정 명령:
- npx wrangler secret put DISCORD_WEBHOOK_URL
- npx wrangler secret put BACKUP_FORWARD_TO

로컬 개발용:
- .dev.vars.example를 복사해 .dev.vars 생성 후 값 입력
- .dev.vars는 Git에 커밋하지 않습니다.

## 4) 직원용 운영 절차 (일상)

### A. 신규 서비스 가입/인증 코드 확인

1. Discord 알림 채널에서 메타데이터 먼저 확인
   - 보낸사람, 제목으로 신뢰도 판단
2. 본문 메시지에서 인증코드/링크 확인
3. 본문이 길면 첨부 txt 열어서 확인

### B. 알림이 안 왔을 때

1. 발신 메일이 실제 수신되었는지 확인
2. Cloudflare Email Routing 규칙이 Worker에 바인딩되어 있는지 확인
3. Worker 배포 최신 여부 확인
   - npm run deploy
4. 시크릿 누락 여부 확인
   - DISCORD_WEBHOOK_URL
5. Discord 채널/웹훅 유효성 확인

### C. 긴 메일 처리 방식

- 4,000자 이하: 본문 단일 메시지
- 4,001 ~ 12,000자: 본문 분할 메시지
- 12,000자 초과: 본문 요약 + txt 첨부

## 5) 장애 대응 (운영자)

### 429 Too Many Requests 발생 시

현재 코드 동작:
- Retry-After, X-RateLimit-Reset-After를 읽어 자동 재시도

운영 대응:
1. 특정 시간대에 메일 버스트가 있는지 확인
2. 같은 웹훅으로 과도 전송 시 웹훅 분산 검토
3. 필요 시 큐 기반 직렬 전송 도입 (docs/OPEN_ITEMS.md 참고)

### 한글 깨짐 발생 시

현재 코드 동작:
- MIME encoded-word(subject/from/to) 디코딩
- charset 기반 본문 디코딩 및 한국어 계열 charset 보정

운영 대응:
1. 깨진 샘플 원문을 수집
2. 발신 시스템 인코딩 확인
3. 재현 샘플 기반으로 디코딩 규칙 보완

## 6) 보안 규칙

반드시 지킬 것:
- 실제 웹훅 URL, 토큰, 키를 코드/문서/채팅에 노출하지 않기
- 웹훅 유출 의심 시 즉시 폐기 후 재발급
- 민감정보 포함 메일은 퍼블릭 채널 공유 금지

권장:
- 정기 시크릿 로테이션
- 커밋 전 시크릿 스캔

## 7) 점검 체크리스트 (배포 전/후)

배포 전:
- 최신 코드 pull
- 시크릿 값 확인
- 로컬 테스트 1회

배포 후:
- 테스트 메일 발송
- Discord에서 메타데이터 -> 본문 순서 확인
- 긴 본문 분할/첨부 동작 확인
- 한글 제목/본문 정상 표시 확인

## 8) 역할 분담 권장

- 운영 담당자:
  - 배포, 시크릿 관리, 장애 대응
- 실무 사용자:
  - 알림 확인, 인증코드 처리, 장애 제보

## 9) 관련 문서

- 프로젝트 개요: README.md
- 운영 개선 과제: docs/OPEN_ITEMS.md
- Cloudflare Email Workers Runtime API
  - https://developers.cloudflare.com/email-routing/email-workers/runtime-api/
- Cloudflare Workers Limits
  - https://developers.cloudflare.com/workers/platform/limits/
