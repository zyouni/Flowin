# Render 배포 가이드

## 1. GitHub에 코드 푸시

먼저 코드를 GitHub 저장소에 푸시해야 합니다:

```bash
git add .
git commit -m "Add login system with Google Sheets"
git push origin main
```

## 2. Render에서 새 서비스 생성

1. [Render 대시보드](https://dashboard.render.com/)에 로그인
2. "New +" 버튼 클릭 > "Web Service" 선택
3. GitHub 저장소 연결 (zyouni/Flowin)
4. 서비스 설정:
   - **Name**: `web-timer` (또는 원하는 이름)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free tier 선택 가능

## 3. 환경 변수 설정

Render 대시보드의 "Environment" 섹션에서 다음 환경 변수들을 추가하세요:

### 필수 환경 변수 (로그인 기능)

```
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id_here
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project-id.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----\n
SESSION_SECRET=your-random-secret-key-here-change-this
```

### 선택적 환경 변수 (기존 Airtable 기능)

```
AIRTABLE_API_KEY=your_airtable_api_key
AIRTABLE_BASE_ID=your_airtable_base_id
AIRTABLE_TABLE_NAME=your_airtable_table_name
```

### 중요 사항

1. **GOOGLE_PRIVATE_KEY**: 
   - JSON 키 파일에서 `private_key` 값을 복사
   - 줄바꿈 문자(`\n`)를 그대로 포함해야 함
   - Render에서는 여러 줄 입력이 어려우므로 `\n`을 문자열로 포함
   - 예: `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQ...\n-----END PRIVATE KEY-----\n`

2. **SESSION_SECRET**: 
   - 프로덕션에서는 반드시 강력한 랜덤 문자열 사용
   - 예: `openssl rand -hex 32` 명령어로 생성 가능

3. **PORT**: 
   - Render가 자동으로 설정하므로 추가할 필요 없음

## 4. 배포 확인

1. "Create Web Service" 버튼 클릭
2. 배포가 완료될 때까지 대기 (보통 2-5분)
3. 배포 완료 후 제공되는 URL로 접속
4. `/login.html` 경로로 접속하여 로그인 테스트

## 5. 문제 해결

### 로그인 실패 시

1. Render 대시보드의 "Logs" 탭에서 오류 확인
2. 환경 변수가 올바르게 설정되었는지 확인
3. Google Sheets 공유 설정 확인 (Service Account 이메일에 접근 권한 부여)

### Google Sheets API 오류

- Google Cloud Console에서 "Google Sheets API" 활성화 확인
- Service Account JSON 파일 형식 확인
- 스프레드시트 ID가 올바른지 확인

### 세션 문제

- `SESSION_SECRET`이 설정되었는지 확인
- HTTPS 환경에서는 쿠키가 자동으로 secure로 설정됨

## 6. 도메인 설정 (선택)

1. Render 대시보드에서 "Settings" > "Custom Domain" 선택
2. 도메인 추가 및 DNS 설정
3. SSL 인증서는 자동으로 발급됨

## 참고

- 무료 플랜은 서비스가 15분간 비활성화되면 자동으로 sleep 모드로 전환됩니다
- 첫 요청 시 약간의 지연이 있을 수 있습니다
- 로그는 Render 대시보드의 "Logs" 탭에서 실시간으로 확인 가능합니다

