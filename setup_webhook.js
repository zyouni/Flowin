const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

// 환경변수에서 설정 가져오기
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;

// 웹훅 URL (서버 IP 주소로 변경 필요)
const WEBHOOK_URL = 'http://192.168.219.190:3001/airtable-webhook';

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

async function setupWebhook() {
    try {
        console.log('🔧 Airtable 웹훅 설정 시작...');
        console.log(`📡 웹훅 URL: ${WEBHOOK_URL}`);
        console.log(`📊 테이블: ${AIRTABLE_TABLE_NAME}`);
        
        // 기존 웹훅 확인
        console.log('🔍 기존 웹훅 확인 중...');
        try {
            const response = await axios.get(`${AIRTABLE_API_BASE}/bases/${AIRTABLE_BASE_ID}/webhooks`, {
                headers: {
                    'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });
            
            console.log(`📋 기존 웹훅 개수: ${response.data.webhooks.length}`);
            
            // 기존 웹훅 삭제
            for (const webhook of response.data.webhooks) {
                if (webhook.url === WEBHOOK_URL) {
                    console.log(`🗑️ 기존 웹훅 삭제: ${webhook.id}`);
                    await axios.delete(`${AIRTABLE_API_BASE}/bases/${AIRTABLE_BASE_ID}/webhooks/${webhook.id}`, {
                        headers: {
                            'Authorization': `Bearer ${AIRTABLE_API_KEY}`
                        }
                    });
                }
            }
        } catch (error) {
            console.log('⚠️ 기존 웹훅 확인 실패 (무시하고 진행):', error.message);
        }
        
        // 새 웹훅 생성
        console.log('➕ 새 웹훅 생성 중...');
        
        const webhookData = {
            url: WEBHOOK_URL,
            triggers: {
                tableIds: [AIRTABLE_TABLE_NAME],
                options: {
                    filters: {
                        dataTypes: ['cellValuesInFields'],
                        fieldIds: ['원시', '원끝', '심시', '심끝', '진끝']
                    }
                }
            }
        };
        
        const response = await axios.post(`${AIRTABLE_API_BASE}/bases/${AIRTABLE_BASE_ID}/webhooks`, webhookData, {
            headers: {
                'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        const webhook = response.data;
        
        console.log('✅ 웹훅 생성 완료!');
        console.log(`🆔 웹훅 ID: ${webhook.id}`);
        console.log(`🌐 웹훅 URL: ${webhook.url}`);
        console.log(`📊 감시 테이블: ${webhook.triggers.tableIds.join(', ')}`);
        console.log(`👀 감시 필드: ${webhook.triggers.options.filters.fieldIds.join(', ')}`);
        
        // 웹훅 테스트
        console.log('\n🧪 웹훅 테스트 방법:');
        console.log('1. Airtable에서 원시 또는 심시 체크박스를 변경');
        console.log('2. 서버 콘솔에서 웹훅 수신 로그 확인');
        console.log('3. 타이머 시스템에서 라벨 변경 확인');
        
    } catch (error) {
        console.error('❌ 웹훅 설정 실패:', error.message);
        
        if (error.response) {
            console.error('📋 에러 상세:', error.response.data);
        }
        
        console.log('\n🔧 문제 해결 방법:');
        console.log('1. AIRTABLE_API_KEY가 올바른지 확인');
        console.log('2. AIRTABLE_BASE_ID가 올바른지 확인');
        console.log('3. AIRTABLE_TABLE_NAME이 올바른지 확인');
        console.log('4. 서버가 실행 중이고 외부에서 접근 가능한지 확인');
        console.log('5. WEBHOOK_URL의 IP 주소가 올바른지 확인');
        console.log('6. Airtable API 키에 웹훅 권한이 있는지 확인');
    }
}

// 스크립트 실행
setupWebhook(); 