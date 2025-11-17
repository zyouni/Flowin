# Airtable 웹훅 설정 가이드

## 1. 웹훅 URL 확인
서버 시작 시 콘솔에 표시되는 웹훅 URL을 확인하세요:
```
🌐 Airtable 웹훅 URL: http://your-server-ip:3001/airtable-webhook
```

## 2. Airtable에서 웹훅 설정

### 방법 1: Airtable API를 통한 웹훅 설정
```javascript
// Airtable API를 사용하여 웹훅 생성
const Airtable = require('airtable');
const base = new Airtable({ apiKey: 'YOUR_API_KEY' }).base('YOUR_BASE_ID');

// 웹훅 생성
base.createWebhook({
    url: 'http://your-server-ip:3001/airtable-webhook',
    triggers: {
        tableIds: ['YOUR_TABLE_ID'], // 수납 테이블의 ID
        options: {
            filters: {
                dataTypes: ['cellValuesInFields'],
                fieldIds: ['원시', '원끝', '심시', '심끝'] // 감시할 필드들
            }
        }
    }
}).then(webhook => {
    console.log('웹훅 생성 완료:', webhook.id);
}).catch(error => {
    console.error('웹훅 생성 실패:', error);
});
```

### 방법 2: 수동으로 웹훅 설정
1. Airtable API 문서에서 웹훅 생성 API 호출
2. 또는 Airtable 확장 프로그램 사용

## 3. 웹훅 테스트
웹훅이 제대로 설정되었는지 확인:
1. Airtable에서 원시/심시 체크박스 변경
2. 서버 콘솔에서 웹훅 수신 로그 확인
3. 타이머 시스템에서 라벨 변경 확인

## 4. 장점
- 실시간 반응 (폴링 대신 즉시 반영)
- 서버 리소스 절약
- 더 정확한 동기화

## 5. 주의사항
- 서버가 외부에서 접근 가능해야 함
- HTTPS 권장 (보안)
- 웹훅 URL이 변경되면 Airtable에서도 업데이트 필요 