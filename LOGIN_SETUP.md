# 로그인 시스템 설정 가이드

Google Sheets를 사용한 로그인 시스템을 설정하는 방법입니다.

## 1. Google Sheets 스프레드시트 준비

1. Google Drive에서 새로운 스프레드시트를 만듭니다
2. 첫 번째 행에 다음 헤더를 입력합니다:
   - `병원ID` (또는 `ID`, `Hospital ID` 등)
   - `비밀번호` (또는 `Password`, `PW` 등)
   - 필요시 추가 정보 컬럼도 추가 가능합니다

3. 각 행에 병원별 로그인 정보를 입력합니다:
   ```
   병원ID    | 비밀번호
   ----------|----------
   hospital1 | password123
   hospital2 | password456
   ```

4. 스프레드시트를 공유 설정에서 "링크가 있는 모든 사용자"에게 "뷰어" 권한을 부여합니다 (또는 Service Account에 접근 권한 부여)

## 2. Google Service Account 생성

1. [Google Cloud Console](https://console.cloud.google.com/)에 접속
2. 새 프로젝트 생성 또는 기존 프로젝트 선택
3. "API 및 서비스" > "사용자 인증 정보"로 이동
4. "사용자 인증 정보 만들기" > "서비스 계정" 선택
5. 서비스 계정 이름 입력 후 생성
6. 생성된 서비스 계정을 클릭하여 "키" 탭으로 이동
7. "키 추가" > "새 키 만들기" > "JSON" 선택
8. 다운로드된 JSON 파일에서 다음 정보를 복사:
   - `client_email` (서비스 계정 이메일)
   - `private_key` (개인 키)

## 3. 스프레드시트 공유 설정

1. Google Sheets에서 생성한 스프레드시트를 엽니다
2. "공유" 버튼 클릭
3. 서비스 계정 이메일을 추가하고 "뷰어" 권한 부여
4. 스프레드시트 URL에서 Spreadsheet ID를 복사합니다:
   ```
   https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit
   ```

## 4. 환경 변수 설정

`.env` 파일에 다음 변수들을 추가합니다:

```env
# Google Sheets 설정
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id_here
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project-id.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----\n"

# 세션 시크릿 (프로덕션에서는 반드시 변경하세요)
SESSION_SECRET=your-random-secret-key-here

# 기존 Airtable 설정 (필요시)
AIRTABLE_API_KEY=your_airtable_api_key
AIRTABLE_BASE_ID=your_airtable_base_id
AIRTABLE_TABLE_NAME=your_airtable_table_name
```

**주의사항:**
- `GOOGLE_PRIVATE_KEY`는 JSON 파일에서 복사할 때 `\n` 문자가 포함되어 있어야 합니다
- Render 등 클라우드 환경에서는 환경 변수로 설정하세요

## 5. 패키지 설치

```bash
npm install
```

필요한 패키지:
- `googleapis`: Google Sheets API 연동
- `express-session`: 세션 관리

## 6. 테스트

1. 서버 실행:
   ```bash
   npm start
   ```

2. 브라우저에서 `http://localhost:3001/login.html` 접속

3. Google Sheets에 등록한 병원 ID와 비밀번호로 로그인 테스트

## 문제 해결

### 로그인이 안 될 때
- Google Sheets의 헤더가 올바른지 확인 (ID, 비밀번호 컬럼이 있는지)
- Service Account에 스프레드시트 접근 권한이 있는지 확인
- 환경 변수가 올바르게 설정되었는지 확인
- 서버 로그에서 오류 메시지 확인

### Google Sheets API 오류
- Google Cloud Console에서 "Google Sheets API"가 활성화되어 있는지 확인
- Service Account JSON 파일의 형식이 올바른지 확인

