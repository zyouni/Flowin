// Airtable Automations 웹훅 스크립트 - 이벤트 타입별 처리
// 이 스크립트는 Airtable에서 레코드가 변경될 때마다 실행됩니다

let record = input.config();  // 자동화에서 레코드 정보 받기

const webhookUrl = "http://192.168.219.190/airtable-webhook";

// 이벤트 타입 결정 (조건에 따라)
let eventType = 'status_update'; // 기본값

// 환자 입장 조건: 수납일이 오늘이고 방이 비지 않았을 때
if (record.수납일 && record.방 && record.이름) {
    const today = new Date().toISOString().split('T')[0];
    const receiptDate = record.수납일.split('T')[0];
    
    if (receiptDate === today && record.방.trim() && record.이름.trim()) {
        eventType = 'room_enter';
    }
}

// 환자 퇴장 조건: 진끝이 체크되었을 때
if (record.진끝 === true) {
    eventType = 'room_exit';
}

// 이벤트 타입별 페이로드 생성
const payload = {
    eventType: eventType,
    recordId: record.recordId || null,
    방: record.방 || null,
    이름: record.이름 || null,
    updatedAt: new Date().toISOString(),
    // 체크박스 필드들 (status_update 이벤트용)
    원시: record.원시 || null,
    원끝: record.원끝 || null,
    심시: record.심시 || null,
    심끝: record.심끝 || null,
    진끝: record.진끝 || null,
    // 기타 필드들
    수납일: record.수납일 || null,
    '비고(순서)': record['비고(순서)'] || null
};

console.log(`📤 웹훅 전송 데이터 (${eventType}):`, payload);

try {
    const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    if (response.ok) {
        const result = await response.json();
        console.log('✅ 웹훅 전송 성공:', result);
        output.set("result", `✅ ${eventType} 이벤트 웹훅 전송 완료!`);
    } else {
        console.error('❌ 웹훅 전송 실패:', response.status, response.statusText);
        output.set("result", `❌ 웹훅 전송 실패: ${response.status}`);
    }
} catch (error) {
    console.error('❌ 웹훅 전송 중 오류:', error);
    output.set("result", `❌ 웹훅 전송 오류: ${error.message}`);
} 