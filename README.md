# Discord Email Forwarder (Cloudflare Email Worker)

Cloudflare Email Workers로 수신 이메일을 처리해 Discord Webhook으로 알림을 보내는 프로젝트입니다.

주요 기능:
- 수신 메일의 보낸 사람, 받는 주소, 제목 표시
- 메일 본문 파싱 (`text/plain` 우선, 없으면 `text/html` 텍스트 변환)
- 본문 길이 제한(Discord embed description 제한 대응)
- 선택적으로 백업 주소로 메일 포워딩

## 1) 요구 사항

- Node.js 18+
- Cloudflare 계정 + 해당 도메인 Email Routing 활성화
- Wrangler CLI (프로젝트에 devDependency로 포함)

## 2) 프로젝트 구조

- `src/worker.js`: Email Worker 본문 파싱/Discord 전송 로직
- `wrangler.jsonc`: Worker 배포 설정
- `.dev.vars.example`: 로컬 개발용 환경변수 예시

## 3) 설치 및 실행

```bash
npm install
npm run dev
```

배포:

```bash
npm run deploy
```

## 4) 환경변수/시크릿 설정

이 프로젝트는 민감값을 코드에 하드코딩하지 않습니다.

필수/선택 변수:
- `DISCORD_WEBHOOK_URL` (필수): Discord Webhook URL
- `BACKUP_FORWARD_TO` (선택): 백업 포워딩용 이메일 주소

### 로컬 개발

`.dev.vars.example`를 참고해 `.dev.vars` 파일을 만들어 사용하세요.

예시:

```env
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/REPLACE_ME/REPLACE_ME"
BACKUP_FORWARD_TO="you@example.com"
```

`.dev.vars`는 `.gitignore`에 포함되어 있어 Git에 올라가지 않습니다.

### Cloudflare 시크릿 등록 (배포 환경)

```bash
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler secret put BACKUP_FORWARD_TO
```

## 5) Email Routing 연결 방법

1. Cloudflare Dashboard에서 Email Routing 활성화
2. Worker를 배포
3. Email Routing -> Email Workers에서 수신 주소(예: `signup@your-domain.com`)를 이 Worker에 바인딩
4. `message.forward()`를 사용하는 경우, 대상 주소는 Cloudflare에서 Verified destination 이어야 함

## 6) Git 업로드 정책 (중요)

Git에 올려도 되는 것:
- 소스 코드
- `wrangler.jsonc`
- `.dev.vars.example`

Git에 올리면 안 되는 것:
- 실제 Discord Webhook URL
- API 키/토큰/비밀번호
- 실제 `.dev.vars`, `.env`

권장 사항:
- 과거에 웹훅이 코드에 노출된 적이 있으면 폐기 후 재발급
- PR/커밋 전 시크릿 스캔 도구 사용 권장

## 7) 동작 개요

1. Email Worker가 수신 메일 이벤트를 받음
2. `message.raw`에서 MIME 파싱
3. 본문 텍스트 추출 및 정리
4. Discord webhook으로 embed 전송
5. `BACKUP_FORWARD_TO`가 있으면 해당 주소로 추가 포워딩

## 8) 트러블슈팅

- Discord에 본문이 안 보일 때
  - `DISCORD_WEBHOOK_URL` 설정 여부 확인
  - 본문이 너무 길면 자동으로 잘려 전송됨
- 메일 포워딩 실패 시
  - `BACKUP_FORWARD_TO` 주소가 Verified destination인지 확인
- 배포 후 런타임 동작 차이
  - `wrangler.jsonc`의 `compatibility_date`를 최신으로 유지

## 9) 참고 문서

- Cloudflare Email Workers Runtime API:
  - https://developers.cloudflare.com/email-routing/email-workers/runtime-api/
- Cloudflare Workers Limits:
  - https://developers.cloudflare.com/workers/platform/limits/
