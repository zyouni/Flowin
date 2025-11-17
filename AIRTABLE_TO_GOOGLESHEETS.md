# Airtable → Google Sheets 전환 가이드

현재 코드는 Airtable을 선택적으로 사용하도록 수정되었습니다. Airtable 환경 변수가 없어도 서버가 정상적으로 실행됩니다.

## 현재 상태

- ✅ Airtable이 없어도 서버가 실행됨
- ✅ Airtable 관련 함수들이 조건부로 처리됨
- ⚠️ Google Sheets로 환자 목록/내원 기록 관리 기능은 아직 구현되지 않음

## 다음 단계: Google Sheets로 전환

### 1. Google Sheets 구조 설계

각 병원별로 별도의 Google Sheet를 사용:
- 로그인 정보 스프레드시트: `login_info` (이미 구현됨)
  - `clinicId`, `clinicName`, `loginId`, `password`, `data_sheet_id`
  
- 환자 데이터 스프레드시트: 각 병원별로 별도 시트
  - `data_sheet_id`에 저장된 스프레드시트 ID 사용
  - 환자 목록 시트: 환자 기본 정보
  - 내원 기록 시트: 내원별 치료 기록

### 2. 구현해야 할 기능

1. **환자 목록 조회**
   - Google Sheets에서 환자 목록 읽기
   - 방별 환자 이름 표시

2. **내원 기록 관리**
   - 새로운 내원 생성
   - 치료 진행 상황 업데이트
   - 치료 시간 기록

3. **실시간 동기화**
   - Socket.IO를 통한 실시간 업데이트
   - 여러 사용자가 동시에 접근 가능

### 3. Google Sheets API 함수 예시

```javascript
// 환자 목록 조회
async function getPatientsFromSheet(spreadsheetId) {
    const response = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: spreadsheetId,
        range: '환자목록!A:Z',
    });
    return response.data.values;
}

// 내원 기록 추가
async function addVisitRecord(spreadsheetId, visitData) {
    await sheetsClient.spreadsheets.values.append({
        spreadsheetId: spreadsheetId,
        range: '내원기록!A:Z',
        valueInputOption: 'RAW',
        resource: { values: [visitData] }
    });
}
```

### 4. 환경 변수

현재 필요한 환경 변수:
- `GOOGLE_SHEETS_SPREADSHEET_ID` (로그인 정보용)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `SESSION_SECRET`

추가로 필요할 수 있는 변수:
- 각 병원별 데이터 스프레드시트는 `login_info` 시트의 `data_sheet_id`에서 가져옴

## 참고

- Airtable 관련 코드는 그대로 유지되어 있지만, 환경 변수가 없으면 동작하지 않음
- Google Sheets로 전환 시 Airtable 관련 함수들을 Google Sheets 함수로 대체 필요

