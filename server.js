const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const dotenv = require('dotenv');
const session = require('express-session');

// 모듈 import
const authRoutes = require('./routes/auth');
const { requireAuth } = require('./middleware/auth');
const { fetchPatientsFromGoogleSheets } = require('./services/googleSheets');

dotenv.config(); // 👈 반드시 상단에서 호출

// Airtable 설정 (선택적 - 더 이상 사용하지 않음)
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;

// Airtable 초기화 (선택적 - API 키가 있을 때만)
let base = null;
if (AIRTABLE_API_KEY && AIRTABLE_BASE_ID) {
    try {
        // airtable 패키지가 설치되어 있지 않을 수 있으므로 try-catch로 처리
        let Airtable;
        try {
            Airtable = require('airtable');
        } catch (requireError) {
            console.log('ℹ️ airtable 패키지가 설치되지 않았습니다. Google Sheets만 사용합니다.');
            Airtable = null;
        }
        
        if (Airtable) {
            base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
            console.log('✅ Airtable 초기화 완료 (선택적 사용)');
        }
    } catch (error) {
        console.warn('⚠️ Airtable 초기화 실패 (무시됨):', error.message);
    }
} else {
    console.log('ℹ️ Airtable 설정이 없습니다. Google Sheets만 사용합니다.');
}

const app = express();
const server = http.createServer(app);

// 세션 설정
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // HTTPS에서만 쿠키 전송 (프로덕션)
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24시간
    }
}));

const io = socketIo(server, {
    allowEIO3: true
});

// Socket.IO에서 세션 접근을 위한 미들웨어
io.use((socket, next) => {
    const req = socket.request;
    const res = socket.request.res || {};
    // express-session 미들웨어 실행
    session({
        secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000
        }
    })(req, res, next);
});

app.use(express.static('public'));
app.use(express.json()); // JSON 파싱을 위한 미들웨어 추가

// 인증 라우트 등록
app.use('/', authRoutes);

const ROOM_NAMES = [
    '상쾌', '편안', '행복', '두뇌', '감각', '처음1', '처음2', '미소'
];

const TREATMENT_ORDER_FIELDS = {
    원상: { label: '원장진료', checkboxField: '원시', timeField: '원시시간', resetFields: ['원끝', '원진종료'] },
    심상: { label: '심리상담', checkboxField: '심시', timeField: '심시시간', resetFields: ['심끝', '심상종료'] },
    침: { label: '침', checkboxField: '침', timeField: '침시작', resetFields: ['침종료', '침끝', '침끝2'] },
    부항: { label: '부항', checkboxField: '부항', timeField: '부항시작', resetFields: ['부항종료', '부항끝'] },
    뜸: { label: '뜸', checkboxField: '뜸', timeField: '뜸시작', resetFields: ['뜸종료', '뜸끝'] },
    안내중: { label: '안내중', checkboxField: '안시', timeField: '안내시작', resetFields: ['안끝', '안내끝'] },
    검사중: { label: '검사중', checkboxField: '검시', timeField: '검사시작', resetFields: ['검끝'] }
};

const TIMER_LABEL_TO_STATUS_KEY = {
    '침': '침',
    '부항': '부항',
    '뜸': '뜸',
    '진료중': '원상',
    '상담중': '심상',
    '검사중': '검사중',
    '안내중': '안내중'
};

// 루트 경로 - 메인 페이지 (인증 필요)
app.get('/', requireAuth, (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// 개별 방 화면용 동적 라우트 (인증 필요)
app.get('/room/:roomName', requireAuth, (req, res) => {
    const roomName = decodeURIComponent(req.params.roomName);
    
    // 유효한 방 이름인지 확인
    if (!ROOM_NAMES.includes(roomName)) {
        return res.status(404).send('존재하지 않는 방입니다.');
    }
    
    // room.html 파일 전송
    res.sendFile(__dirname + '/public/room.html');
});

// 문 앞 태블릿용 화면 라우트 (인증 필요)
app.get('/room2/:roomName', requireAuth, (req, res) => {
    const roomName = decodeURIComponent(req.params.roomName);

    if (!ROOM_NAMES.includes(roomName)) {
        return res.status(404).send('존재하지 않는 방입니다.');
    }

    res.sendFile(__dirname + '/public/room2.html');
});

// 방별 치료 진행 상황 조회 API (인증 필요)
app.get('/api/room/:roomName/treatment-status', requireAuth, async (req, res) => {
    try {
        const roomName = decodeURIComponent(req.params.roomName);

        if (!ROOM_NAMES.includes(roomName)) {
            return res.status(404).json({ error: '존재하지 않는 방입니다.' });
        }

        const recordId = roomRecordIds[roomName];
        if (!recordId) {
            return res.json({
                room: roomName,
                patientName: roomNames[roomName] || '',
                doctorName: '',
                counselorName: '',
                needleCount: 10,
                hasPatient: !!(roomNames[roomName] && roomNames[roomName].trim()),
                treatmentStatus: {
                    원상: { completed: false, inProgress: false },
                    침: { completed: false, inProgress: false },
                    부항: { completed: false, inProgress: false },
                    뜸: { completed: false, inProgress: false },
                    심상: { completed: false, inProgress: false },
                    검사중: { completed: false, inProgress: false },
                    안내중: { completed: false, inProgress: false }
                }
            });
        }

        const record = await getAirtableRecord(recordId);
        const fields = record.fields;

        console.log('🧾 treatment-status 요청 Airtable 필드:', {
            room: roomName,
            recordId,
            원시: fields['원시'],
            원끝: fields['원끝'],
            원상: fields['원상'],
            침: fields['침'],
            침종료: fields['침종료'],
            부항: fields['부항'],
            부항종료: fields['부항종료'],
            부항시작: fields['부항시작'],
            뜸: fields['뜸'],
            뜸종료: fields['뜸종료'],
            뜸시작: fields['뜸시작'],
            검사중: fields['검사중'],
            검시: fields['검시'],
            검끝: fields['검끝'],
            안내중: fields['안내중'],
            안시: fields['안시'],
            안끝: fields['안끝'],
            심시: fields['심시'],
            심끝: fields['심끝'],
            심상: fields['심상']
        });
        const patientKey = recordId || (roomNames[roomName] ? `${roomName}-${roomNames[roomName]}` : '');
        updateTreatmentOrderCache(roomName, patientKey, fields);
        const { sequences, startTimes, endTimes } = getTreatmentOrderSnapshot(roomName);
        const doctorName = fields['주치의(make)'] || fields['주치의'] || '';
        const counselorName = fields['심리(sql)'] || '';
        const hasPsychology = Boolean((fields['심리'] && fields['심리'].length > 0) || counselorName);
        const needleCount = fields['침갯수'] || 10;
        const activeTimerLabel = (roomTimers[roomName] && roomTimers[roomName].isRunning && roomTimers[roomName].label)
            ? roomTimers[roomName].label.trim()
            : '';

        const isChecked = (field) => fields[field] === true;
        const textEquals = (field, ...expected) => {
            const value = fields[field];
            if (typeof value !== 'string') return false;
            return expected.includes(value.trim());
        };

        const treatmentStatus = {
            원상: {
                completed: isChecked('원끝') || textEquals('원상', '완료'),
                inProgress: isChecked('원시') && !isChecked('원끝')
            },
            침: {
                completed: isChecked('침종료') || isChecked('침끝'),
                inProgress: isChecked('침') && !isChecked('침종료') && !isChecked('침끝')
            },
            부항: {
                completed: isChecked('부항종료') || isChecked('부항끝'),
                inProgress: isChecked('부항') && !isChecked('부항종료') && !isChecked('부항끝')
            },
            뜸: {
                completed: isChecked('뜸종료') || isChecked('뜸끝'),
                inProgress: isChecked('뜸') && !isChecked('뜸종료') && !isChecked('뜸끝')
            },
            심상: {
                completed: isChecked('심끝') || textEquals('심상', '완료'),
                inProgress: isChecked('심시') && !isChecked('심끝')
            },
            검사중: {
                completed: isChecked('검끝'),
                inProgress: isChecked('검시') && !isChecked('검끝')
            },
            안내중: {
                completed: isChecked('안끝'),
                inProgress: isChecked('안시') && !isChecked('안끝')
            }
        };

        return res.json({
            room: roomName,
            patientName: roomNames[roomName] || '',
            doctorName,
            counselorName,
            needleCount,
            hasPatient: !!(roomNames[roomName] && roomNames[roomName].trim()),
            treatmentStatus,
            sequences,
            startTimes,
            endTimes,
            activeTimerLabel
        });
    } catch (error) {
        console.error('❌ treatment-status 조회 실패:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// 방별 환자 이름 저장 (메모리)
const roomNames = {};
const roomOccupied = {};
const roomRecordIds = {};
const roomTimers = {};

// 치료 순서 캐시
const treatmentOrderCache = {};

function resetTreatmentOrderCache(room) {
    delete treatmentOrderCache[room];
}

function updateTreatmentOrderCache(room, patientKey, fields) {
    if (!treatmentOrderCache[room]) {
        treatmentOrderCache[room] = {};
    }
    if (!treatmentOrderCache[room][patientKey]) {
        treatmentOrderCache[room][patientKey] = {};
    }
    treatmentOrderCache[room][patientKey] = fields;
}

function getPatientKeyForRoom(room) {
    const recordId = roomRecordIds[room];
    if (recordId) return recordId;
    const name = roomNames[room];
    if (name) return `${room}-${name}`;
    return null;
}

function getTreatmentOrderSnapshot(room) {
    const patientKey = getPatientKeyForRoom(room);
    if (!patientKey || !treatmentOrderCache[room] || !treatmentOrderCache[room][patientKey]) {
        return { sequences: {}, startTimes: {}, endTimes: {} };
    }

    const fields = treatmentOrderCache[room][patientKey];
    const items = [];

    Object.keys(TREATMENT_ORDER_FIELDS).forEach(statusKey => {
        const config = TREATMENT_ORDER_FIELDS[statusKey];
        const checkboxValue = fields[config.checkboxField];
        const timeValue = fields[config.timeField];

        if (checkboxValue === true && timeValue) {
            const assignedOrder = parseInt(fields[`${statusKey}_순서`] || '0', 10);
            items.push({
                key: statusKey,
                startTime: new Date(timeValue).getTime(),
                assignedOrder
            });
        }
    });

    items.sort((a, b) => {
        if (a.assignedOrder !== b.assignedOrder) {
            return a.assignedOrder - b.assignedOrder;
        }
        return a.assignedOrder - b.assignedOrder;
    });

    const sequences = {};
    const startTimes = {};
    const endTimes = {};
    items.forEach((item, index) => {
        sequences[item.key] = index + 1;
        startTimes[item.key] = Number.isFinite(item.startTime) ? new Date(item.startTime).toISOString() : null;
        endTimes[item.key] = Number.isFinite(item.endTime) ? new Date(item.endTime).toISOString() : null;
    });

    return { sequences, startTimes, endTimes };
}

// 기존 서버와 Socket.IO 연결
const existingServerSocket = require('socket.io-client')('http://192.168.219.190:3002');

// fetchPatientsFromGoogleSheets는 services/googleSheets.js로 이동됨

// 기존 서버에서 이름 데이터를 가져오는 함수 (하위 호환성)
async function fetchNamesFromAirtable() {
    // 세션에서 dataSheetId 가져오기 (Socket.IO 컨텍스트에서는 직접 전달 필요)
    // 일단 기존 방식 유지 (기존 서버 연결)
    try {
        console.log('📡 기존 서버에서 이름 데이터 요청 중...');
        
        return new Promise((resolve, reject) => {
            // 기존 서버에 이름 새로고침 요청
            existingServerSocket.emit('refreshNames');
            
            // 응답 대기
            const timeout = setTimeout(() => {
                reject(new Error('기존 서버 응답 시간 초과'));
            }, 5000);
            
            // 이름 데이터 수신
            existingServerSocket.once('namesRefreshed', (data) => {
                clearTimeout(timeout);
                console.log('✅ 기존 서버에서 이름 데이터 받음:', data);
                
                // recordIds도 저장
                if (data.recordIds) {
                    roomRecordIds = data.recordIds;
                }
                
                resolve(data);
            });
        });
    } catch (error) {
        console.error('❌ 기존 서버에서 이름 가져오기 실패:', error.message);
        throw error;
    }
}

// Airtable 수납 테이블 업데이트 함수 (더 이상 사용하지 않음 - Google Sheets로 전환 예정)
async function updateAirtablePayment(recordId, treatmentInfo, isCompleted = false) {
    if (!base || !AIRTABLE_TABLE_NAME) {
        console.log('ℹ️ Airtable이 설정되지 않아 업데이트를 건너뜁니다.');
        return Promise.resolve();
    }
    try {
        console.log(`📝 Airtable 수납 테이블 업데이트: recordId=${recordId}, treatmentInfo=${treatmentInfo}, isCompleted=${isCompleted}`);
        
        return new Promise((resolve, reject) => {
            // 기존 내용을 지우고 새롭게 업데이트
            safeAirtableUpdate(recordId, {
                '비고(순서)': treatmentInfo
            }, (err, record) => {
                if (err) {
                    console.error('❌ Airtable 업데이트 실패:', err);
                    reject(err);
                } else {
                    console.log('✅ Airtable 수납 테이블 업데이트 완료:', record.fields);
                    resolve(record);
                }
            });
        });
    } catch (error) {
        console.error('❌ Airtable 수납 테이블 업데이트 실패:', error.message);
        throw error;
    }
}

// Airtable에서 기존 데이터 확인 함수 (더 이상 사용하지 않음 - Google Sheets로 전환 예정)
async function getAirtableRecord(recordId) {
    if (!base || !AIRTABLE_TABLE_NAME) {
        console.log('ℹ️ Airtable이 설정되지 않아 레코드 조회를 건너뜁니다.');
        // 빈 레코드 반환 (기존 코드와의 호환성 유지)
        return { fields: {} };
    }
    try {
        return new Promise((resolve, reject) => {
            base(AIRTABLE_TABLE_NAME).find(recordId, (err, record) => {
                if (err) {
                    console.error('❌ Airtable 레코드 조회 실패:', err);
                    reject(err);
                } else {
                    resolve(record);
                }
            });
        });
    } catch (error) {
        console.error('❌ Airtable 레코드 조회 실패:', error.message);
        throw error;
    }
}

// Airtable 업데이트 헬퍼 함수 (base가 없으면 무시)
function safeAirtableUpdate(recordId, updateData, callback) {
    if (!base || !AIRTABLE_TABLE_NAME) {
        console.log('ℹ️ Airtable이 설정되지 않아 업데이트를 건너뜁니다.');
        if (callback) callback(null, { fields: {} });
        return;
    }
    base(AIRTABLE_TABLE_NAME).update(recordId, updateData, callback);
}

// Airtable 치료별 시간 기록 함수 (더 이상 사용하지 않음 - Google Sheets로 전환 예정)
async function updateTreatmentTime(recordId, treatmentType, timeValue) {
    if (!base || !AIRTABLE_TABLE_NAME) {
        console.log('ℹ️ Airtable이 설정되지 않아 치료 시간 기록을 건너뜁니다.');
        return Promise.resolve();
    }
    try {
        console.log(`📝 Airtable 치료 시간 기록: recordId=${recordId}, ${treatmentType}=${timeValue}`);
        
        // 침 치료인 경우 기존 데이터 확인
        if (treatmentType === '침시작' || treatmentType === '침끝') {
            try {
                const existingRecord = await getAirtableRecord(recordId);
                const fields = existingRecord.fields;
                
                // 기존 침시작/침끝이 있으면 2차 필드에 기록
                if (treatmentType === '침시작' && fields['침시작']) {
                    treatmentType = '침시작2';
                    console.log(`📝 기존 침시작이 존재하여 침시작2에 기록: ${timeValue}`);
                } else if (treatmentType === '침끝' && fields['침끝']) {
                    treatmentType = '침끝2';
                    console.log(`📝 기존 침끝이 존재하여 침끝2에 기록: ${timeValue}`);
                }
            } catch (error) {
                console.log(`⚠️ 기존 데이터 확인 실패, 기본 필드에 기록: ${error.message}`);
            }
        }
        
        return new Promise((resolve, reject) => {
            const updateData = {};
            updateData[treatmentType] = timeValue;
            
            safeAirtableUpdate(recordId, updateData, (err, record) => {
                if (err) {
                    console.error(`❌ Airtable ${treatmentType} 시간 기록 실패:`, err);
                    reject(err);
                } else {
                    console.log(`✅ Airtable ${treatmentType} 시간 기록 완료:`, record.fields);
                    resolve(record);
                }
            });
        });
    } catch (error) {
        console.error(`❌ Airtable ${treatmentType} 시간 기록 실패:`, error.message);
        throw error;
    }
}

// Airtable에서 진끝 상태 확인 함수
async function checkTreatmentEnd(recordId) {
    try {
        const record = await getAirtableRecord(recordId);
        return record.fields['진끝'] === true;
    } catch (error) {
        console.error('❌ 진끝 상태 확인 실패:', error);
        return false;
    }
}

// Airtable 체크박스 변경에 따른 라벨 업데이트 함수
async function updateLabelFromAirtableCheckboxes(recordId, room) {
    try {
        const record = await getAirtableRecord(recordId);
        const fields = record.fields;
        
        console.log(`🔍 Airtable 체크박스 상태 확인 - recordId: ${recordId}, room: ${room}, fields:`, fields);
        
        // 체크박스 상태에 따라 라벨 결정
        let newLabel = '';
        
        if (fields['원시'] && !fields['원끝']) {
            newLabel = '진료중';
        } else if (fields['심시'] && !fields['심끝']) {
            newLabel = '상담중';
        } else if (fields['검시'] && !fields['검끝']) {
            newLabel = '검사중';
        } else if (fields['안시'] && !fields['안끝']) {
            newLabel = '안내중';
        } else if (fields['침'] && !fields['침종료'] && !fields['침끝']) {
            newLabel = '침';
        } else if (fields['부항'] && !fields['부항종료'] && !fields['부항끝']) {
            newLabel = '부항';
        } else if (fields['뜸'] && !fields['뜸종료'] && !fields['뜸끝']) {
            newLabel = '뜸';
        }
        
        // 현재 라벨과 다르면 업데이트
        const currentLabel = roomTimers[room] ? roomTimers[room].label : '';
        if (newLabel !== currentLabel) {
            if (roomTimers[room]) {
                roomTimers[room].label = newLabel;
                
                // 카운트업 모드 여부 업데이트
                const isCountUp = ['진료중', '상담중', '대기중', '검사중', '안내중'].includes(newLabel);
                roomTimers[room].isCountUp = isCountUp;
                
                console.log(`✅ ${room} 타이머 라벨 업데이트: ${currentLabel} → ${newLabel} (카운트업: ${isCountUp})`);
                
                // 클라이언트에 업데이트된 상태 전송
                io.emit('timerState', { room, state: { ...roomTimers[room] } });
            }
        }
        
    } catch (error) {
        console.error(`❌ Airtable 체크박스 기반 라벨 업데이트 실패: ${room}`, error.message);
    }
}

// Airtable 치료 체크박스 업데이트 함수
async function updateTreatmentCheckbox(recordId, treatmentLabel) {
    try {
        console.log(`📝 Airtable 치료 체크박스 업데이트: recordId=${recordId}, treatment=${treatmentLabel}`);
        
        let checkboxField = '';
        if (treatmentLabel === '침') {
            checkboxField = '침';
        } else if (treatmentLabel === '부항') {
            checkboxField = '부항';
        } else if (treatmentLabel === '뜸') {
            checkboxField = '뜸';
        }
        
        if (!checkboxField) {
            console.log(`⚠️ 알 수 없는 치료 타입: ${treatmentLabel}`);
            return;
        }
        
        return new Promise((resolve, reject) => {
            const updateData = {};
            updateData[checkboxField] = true; // 체크박스 체크
            
            safeAirtableUpdate(recordId, updateData, (err, record) => {
                if (err) {
                    console.error(`❌ Airtable ${checkboxField} 체크박스 업데이트 실패:`, err);
                    reject(err);
                } else {
                    console.log(`✅ Airtable ${checkboxField} 체크박스 업데이트 완료:`, record.fields);
                    resolve(record);
                }
            });
        });
    } catch (error) {
        console.error(`❌ Airtable 치료 체크박스 업데이트 실패:`, error.message);
        throw error;
    }
}

// Airtable 새로운 라벨 상태 업데이트 함수
async function updateNewLabelStatus(recordId, label) {
    try {
        console.log(`📝 Airtable 새로운 라벨 상태 업데이트: recordId=${recordId}, label=${label}`);
        
        const updateData = {};
        
        // 라벨에 따라 체크박스 설정
        if (label === '진료중') {
            updateData['원시'] = true;
            updateData['원끝'] = false;
        } else if (label === '상담중') {
            updateData['심시'] = true;
            updateData['심끝'] = false;
        } else if (label === '검사중') {
            updateData['검시'] = true;
            updateData['검끝'] = false;
        } else if (label === '안내중') {
            updateData['안시'] = true;
            updateData['안끝'] = false;
        } else if (label === '침') {
            updateData['침'] = true;
            updateData['침종료'] = false;
            updateData['침끝'] = false;
        } else if (label === '부항') {
            updateData['부항'] = true;
            updateData['부항종료'] = false;
            updateData['부항끝'] = false;
        } else if (label === '뜸') {
            updateData['뜸'] = true;
            updateData['뜸종료'] = false;
            updateData['뜸끝'] = false;
        }
        
        return new Promise((resolve, reject) => {
            safeAirtableUpdate(recordId, updateData, (err, record) => {
                if (err) {
                    console.error(`❌ Airtable 새로운 라벨 상태 업데이트 실패:`, err);
                    reject(err);
                } else {
                    console.log(`✅ Airtable 새로운 라벨 상태 업데이트 완료:`, record.fields);
                    resolve(record);
                }
            });
        });
    } catch (error) {
        console.error(`❌ Airtable 새로운 라벨 상태 업데이트 실패:`, error.message);
        throw error;
    }
}

// Socket.IO 연결 처리
io.on('connection', async (socket) => {
    console.log('========================================');
    console.log('🔌 새로운 클라이언트 연결! Socket ID:', socket.id);
    console.log('========================================');
    
    // 접속 시 자동으로 최신 데이터 가져오기 (F5 효과)
    try {
        console.log('🔄 F5 효과 - 자동 이름 새로고침 실행');
        
        // Socket.IO에서 세션 접근
        const session = socket.request.session;
        const dataSheetId = session?.dataSheetId;
        
        let data;
        if (dataSheetId) {
            console.log('📊 F5 효과 - Google Sheets에서 환자 목록 조회');
            data = await fetchPatientsFromGoogleSheets(dataSheetId, ROOM_NAMES);
        } else {
            console.log('📡 F5 효과 - 기존 서버에서 이름 데이터 요청');
            data = await fetchNamesFromAirtable();
        }
        console.log('📊 F5 효과 - 가져온 이름:', data);
        
        // names 객체에서 이름 데이터 추출
        const names = data.names || data;
        
        // F5 시에도 모든 방을 초기화하고 새 데이터로 완전히 교체
        ROOM_NAMES.forEach(room => {
            roomNames[room] = '';
            roomOccupied[room] = false;
        });
        
        // 기존 서버에서 받은 데이터로 업데이트
        Object.keys(names).forEach(room => {
            roomNames[room] = names[room] || '';
            // 이름이 있으면 점유 중, 없으면 빈 방
            roomOccupied[room] = !!(names[room] && names[room].trim());
        });
        
    // 접속 시 모든 방의 상태 전송
        ROOM_NAMES.forEach(room => {
            socket.emit('timerState', { room, state: roomTimers[room] });
        });
        
        // 클라이언트에 최신 이름과 점유 상태 전송
        socket.emit('namesRefreshed', { names: roomNames, occupied: roomOccupied });
        console.log('📤 F5 효과 - 최신 데이터 전송 완료');
        
        // Airtable 체크박스 상태에 따른 라벨 업데이트 (Google Sheets 사용 시에는 생략)
        if (!dataSheetId) {
            ROOM_NAMES.forEach(room => {
                if (roomRecordIds[room]) {
                    updateLabelFromAirtableCheckboxes(roomRecordIds[room], room);
                }
            });
        }
    } catch (error) {
        console.error('❌ F5 효과 - 자동 이름 새로고침 실패:', error);
        
        // 실패 시 기존 데이터로 전송
    ROOM_NAMES.forEach(room => {
        socket.emit('timerState', { room, state: roomTimers[room] });
        socket.emit('nameUpdate', { room, name: roomNames[room] || '' });
    });
        
        const occupiedState = {};
        ROOM_NAMES.forEach(room => {
            occupiedState[room] = !!(roomNames[room] && roomNames[room].trim());
        });
        socket.emit('namesRefreshed', { names: roomNames, occupied: occupiedState });
    }

    // 타이머 시작 이벤트
    socket.on('startTimer', async ({ room, duration, force = false, label = '' }) => {
        if (!ROOM_NAMES.includes(room)) {
            console.error(`❌ 잘못된 방 이름: ${room}`);
            return;
        }

        if (!roomTimers[room]) {
            roomTimers[room] = {
                isRunning: false,
                timeLeft: 0,
                duration: 0,
                label: '',
                isCountUp: false,
                wasRunning: false
            };
        }

        const timer = roomTimers[room];
        
        // force가 true이거나 타이머가 실행 중이 아니면 시작
        if (force || !timer.isRunning) {
            // 라벨이 전달되면 사용, 없으면 기존 라벨 유지
            if (label && label.trim()) {
                timer.label = label.trim();
            } else if (!timer.label) {
                timer.label = '';
            }
            
            // 카운트업 모드 여부 확인
            const isCountUp = ['진료중', '상담중', '대기중', '검사중', '안내중'].includes(timer.label);
            timer.isCountUp = isCountUp;
            
            if (isCountUp) {
                // 카운트업 모드: duration을 0으로 시작
                timer.timeLeft = 0;
                timer.duration = 0;
            } else {
                // 일반 모드: duration 설정
                timer.timeLeft = duration || 900; // 기본 15분
                timer.duration = duration || 900;
            }
            
            timer.isRunning = true;
            timer.wasRunning = true;
            
            console.log(`▶️ ${room} 타이머 시작: ${timer.timeLeft}초 (라벨: ${timer.label}, 카운트업: ${isCountUp})`);
            
            // 클라이언트에 상태 전송
            io.emit('timerState', { room, state: { ...timer } });
            
            // 치료 순서 기록
            const patientKeyForOrder = getPatientKeyForRoom(room);
            const statusKeyForCompletion = TIMER_LABEL_TO_STATUS_KEY[timer.label] || null;
            if (patientKeyForOrder && statusKeyForCompletion) {
                const completionTimestamp = Date.now();
                recordTreatmentCompletion(room, patientKeyForOrder, statusKeyForCompletion, completionTimestamp);
            }
            
            // 현재 시간을 가져와서 Airtable에 저장할 시간 (ISO - millisecond precision)
            const now = new Date();
            const startTimeForAirtable = now.toISOString();
            
            // 라벨 정보 설정 (전달받은 라벨이 있으면 사용, 없으면 기존 라벨 유지)
            const finalLabel = label && label.trim() ? label : (roomTimers[room] ? roomTimers[room].label : '');
            if (!finalLabel) {
                console.log(`⚠️ ${room} - 유효한 라벨이 없어 타이머 시작을 취소합니다.`);
                return;
            }
            const patientKeyForOrder = getPatientKeyForRoom(room);
            
            // 카운트업 모드 여부 확인 (진료중, 상담중, 대기중은 카운트업)
            const isCountUp = ['진료중', '상담중', '대기중', '검사중', '안내중'].includes(finalLabel);
            
            if (roomNames[room] && roomNames[room].trim()) {
                const recordId = roomRecordIds[room];
                if (recordId) {
                    try {
                        // 라벨에 따라 Airtable 업데이트
                        if (finalLabel === '검사중') {
                            // 검시 체크박스 업데이트
                            await new Promise((resolve, reject) => {
                                safeAirtableUpdate(recordId, {
                                    '검시': true
                                }, (err, record) => {
                                    if (err) {
                                        console.error('❌ 검시 체크박스 업데이트 실패:', err);
                                        reject(err);
                                    } else {
                                        console.log('✅ 검시 체크박스 업데이트 완료');
                                        resolve(record);
                                    }
                                });
                            });
                            
                            await updateTreatmentTime(recordId, '검사시작', startTimeForAirtable);
                            console.log(`✅ 검사시작 시간 기록 성공: ${startTimeForAirtable}`);
                        } else if (finalLabel === '진료중') {
                            // 원시 체크박스 업데이트
                            await new Promise((resolve, reject) => {
                                safeAirtableUpdate(recordId, {
                                    '원시': true,
                                    '원끝': false
                                }, (err, record) => {
                                    if (err) {
                                        console.error('❌ 원시 체크박스 업데이트 실패:', err);
                                        reject(err);
                                    } else {
                                        console.log('✅ 원시 체크박스 업데이트 완료');
                                        resolve(record);
                                    }
                                });
                            });
                            
                            await updateTreatmentTime(recordId, '원시시간', startTimeForAirtable);
                            console.log(`✅ 원시시간 기록 완료: ${startTimeForAirtable}`);
                        } else if (finalLabel === '상담중') {
                            // 심시 체크박스 업데이트
                            await new Promise((resolve, reject) => {
                                safeAirtableUpdate(recordId, {
                                    '심시': true,
                                    '심끝': false
                                }, (err, record) => {
                                    if (err) {
                                        console.error('❌ 심시 체크박스 업데이트 실패:', err);
                                        reject(err);
                                    } else {
                                        console.log('✅ 심시 체크박스 업데이트 완료');
                                        resolve(record);
                                    }
                                });
                            });
                            
                            await updateTreatmentTime(recordId, '심시시간', startTimeForAirtable);
                            console.log(`✅ 심시시간 기록 완료: ${startTimeForAirtable}`);
                        } else if (finalLabel === '안내중') {
                            // 안시 체크박스 업데이트
                            try {
                                await new Promise((resolve, reject) => {
                                    safeAirtableUpdate(recordId, {
                                        '안시': true,
                                        '안끝': false
                                    }, (err, record) => {
                                        if (err) {
                                            console.error('❌ 안내중 체크박스 업데이트 실패:', err);
                                            reject(err);
                                        } else {
                                            console.log('✅ 안내중 체크박스 업데이트 완료 (안시 true, 안끝 false)');
                                            resolve(record);
                                        }
                                    });
                                });
                            } catch (error) {
                                console.error(`❌ ${finalLabel} 새로운 라벨 상태 업데이트 실패:`, error);
                            }
                            
                            await updateTreatmentTime(recordId, '안내시작', startTimeForAirtable);
                            console.log(`✅ 안내시작 시간 기록 완료: ${startTimeForAirtable}`);
                        } else {
                            // 침, 부항, 뜸 등 치료 체크박스 업데이트
                            await updateTreatmentCheckbox(recordId, finalLabel);
                            await updateTreatmentTime(recordId, `${finalLabel}시작`, startTimeForAirtable);
                            console.log(`✅ ${finalLabel}시작 시간 기록 완료: ${startTimeForAirtable}`);
                        }
                        
                        // Airtable 수납 테이블 업데이트
                        const treatmentInfo = `${finalLabel} 진행중`;
                        if (patientKeyForOrder) {
                            try {
                                await updateAirtablePayment(recordId, treatmentInfo, false); // 진행 중인 치료
                                console.log(`✅ Airtable 업데이트 성공: ${room} - ${treatmentInfo}`);
                            } catch (error) {
                                console.error(`❌ Airtable 업데이트 실패: ${room}`, error);
                            }
                        }
                    } catch (error) {
                        console.error(`❌ Airtable 업데이트 실패: ${room}`, error);
                    }
                }
            }
        }
    });

    // 타이머 정지 이벤트
    socket.on('stopTimer', ({ room }) => {
        if (!ROOM_NAMES.includes(room)) return;
        
        if (roomTimers[room]) {
            roomTimers[room].isRunning = false;
            console.log(`⏸️ ${room} 타이머 정지`);
            io.emit('timerState', { room, state: { ...roomTimers[room] } });
        }
    });

    // 타이머 리셋 이벤트
    socket.on('resetTimer', async ({ room }) => {
        if (!ROOM_NAMES.includes(room)) return;
        
        if (roomTimers[room]) {
            const timer = roomTimers[room];
            const wasRunning = timer.isRunning;
            const oldLabel = timer.label;
            
            timer.isRunning = false;
            timer.timeLeft = 0;
            timer.duration = 0;
            timer.label = '';
            timer.isCountUp = false;
            timer.wasRunning = false;
            
            console.log(`🔄 ${room} 타이머 리셋 (이전 라벨: ${oldLabel}, 실행 중이었음: ${wasRunning})`);
            
            // 클라이언트에 상태 전송
            io.emit('timerState', { room, state: { ...timer } });
            
            // Airtable 수납 테이블 업데이트 (비고(순서) 필드 비움)
            if (roomNames[room] && roomNames[room].trim()) {
                const recordId = roomRecordIds[room];
                if (recordId) {
                    try {
                        await updateAirtablePayment(recordId, '', false);
                        console.log(`✅ 타이머 리셋 후 Airtable 비고(순서) 필드 비움: ${room}`);
                    } catch (error) {
                        console.error(`❌ 타이머 리셋 후 Airtable 업데이트 실패: ${room}`, error);
                    }
                }
            }
        }
    });

    // 타이머 조정 이벤트
    socket.on('adjustTimer', async ({ room, diff }) => {
        if (!ROOM_NAMES.includes(room)) return;
        
        if (roomTimers[room]) {
            const timer = roomTimers[room];
            
            // 카운트업 모드에서는 조정 불가
            if (timer.isCountUp) {
                console.log(`⚠️ ${room} - 카운트업 모드에서는 타이머 조정이 불가능합니다.`);
                return;
            }
            
            const oldTime = timer.timeLeft;
            timer.timeLeft = Math.max(0, timer.timeLeft + diff);
            timer.duration = timer.timeLeft;
            
            console.log(`⏱️ ${room} 타이머 조정: ${oldTime}초 → ${timer.timeLeft}초 (차이: ${diff}초)`);
            
            // 클라이언트에 상태 전송
            io.emit('timerState', { room, state: { ...timer } });
            
            // Airtable 수납 테이블 업데이트 (남은 시간)
            if (roomNames[room] && roomNames[room].trim()) {
                const recordId = roomRecordIds[room];
                if (recordId) {
                    const minutes = Math.floor(timer.timeLeft / 60);
                    const seconds = timer.timeLeft % 60;
                    const treatmentInfo = timer.label ? `${timer.label} ${minutes}분 ${seconds}초 남음` : `${minutes}분 ${seconds}초 남음`;
                    try {
                        await updateAirtablePayment(recordId, treatmentInfo, false); // 진행 중인 치료
                        console.log(`✅ 타이머 조정 후 Airtable 업데이트 성공: ${room} - ${treatmentInfo}`);
                    } catch (error) {
                        console.error(`❌ 타이머 조정 후 Airtable 업데이트 실패: ${room}`, error);
                    }
                }
            }
        }
    });

    // 발침완료 이벤트
    socket.on('doneAlarm', async ({ room }) => {
        if (!ROOM_NAMES.includes(room)) return;
        
        if (roomTimers[room]) {
            const timer = roomTimers[room];
            const currentLabel = timer.label || '';
            const now = new Date();
            const endTimeForAirtable = now.toISOString();
            
            timer.isRunning = false;
            timer.wasRunning = false;
            
            console.log(`✅ ${room} 발침완료 처리 (라벨: ${currentLabel})`);
            
            // 클라이언트에 상태 전송
            io.emit('timerState', { room, state: { ...timer } });
            io.emit('doneAlarm', { room, label: currentLabel, finishedAt: endTimeForAirtable });
            
            if (roomNames[room] && roomNames[room].trim()) {
                const recordId = roomRecordIds[room];
                if (recordId) {
                    try {
                        // 라벨에 따라 종료 체크박스 업데이트
                        const behaviors = {
                            '침': { checkbox: '침종료', endTimeField: '침끝' },
                            '부항': { checkbox: '부항종료', endTimeField: '부항끝' },
                            '뜸': { checkbox: '뜸종료', endTimeField: '뜸끝' },
                            '진료중': { checkbox: '원끝', endTimeField: '원진종료' },
                            '상담중': { checkbox: '심끝', endTimeField: '심상종료' },
                            '검사중': { checkbox: '검끝', endTimeField: '검사종료' },
                            '안내중': { checkbox: '안끝', endTimeField: '안내종료' }
                        };
                        
                        const behavior = behaviors[currentLabel];
                        if (behavior) {
                            const payload = {};
                            payload[behavior.checkbox] = true;
                            
                            await new Promise((resolve, reject) => {
                                safeAirtableUpdate(recordId, payload, (err, record) => {
                                    if (err) {
                                        console.error(`❌ ${behavior.checkbox} 체크박스 업데이트 실패:`, err);
                                        reject(err);
                                    } else {
                                        console.log(`✅ ${behavior.checkbox} 체크박스 업데이트 완료`);
                                        resolve(record);
                                    }
                                });
                            });
                            
                            // endTimeForAirtable은 이미 위에서 생성됨
                            await updateAirtablePayment(recordId, '', true);
                            console.log(`✅ 발침완료 후 Airtable 비고(순서) 필드 비움: ${room}`);
                            
                            // 종료 시간 기록
                            if (behavior.endTimeField) {
                                try {
                                    await updateTreatmentTime(recordId, behavior.endTimeField, endTimeForAirtable);
                                    console.log(`✅ ${behavior.endTimeField} 시간 기록 성공: ${endTimeForAirtable}`);
                                } catch (error) {
                                    console.error(`❌ ${behavior.endTimeField} 시간 기록 실패:`, error);
                                }
                            }
                        } else {
                            // 알 수 없는 라벨이면 그냥 비고(순서) 필드만 비움
                            await updateAirtablePayment(recordId, '', true);
                            console.log(`✅ 발침완료 후 Airtable 비고(순서) 필드 비움: ${room} (알 수 없는 라벨: ${currentLabel})`);
                        }
                    } catch (error) {
                        console.error(`❌ 발침완료 후 Airtable 업데이트 실패: ${room}`, error);
                    }
                }
            }
        }
    });

    // 라벨 업데이트 이벤트
    socket.on('updateLabel', async ({ room, label }) => {
        if (!ROOM_NAMES.includes(room)) return;
        
        if (!roomTimers[room]) {
            roomTimers[room] = {
                isRunning: false,
                timeLeft: 0,
                duration: 0,
                label: '',
                isCountUp: false,
                wasRunning: false
            };
        }
        
        const oldLabel = roomTimers[room].label || '';
        roomTimers[room].label = label || '';
        
        // 카운트업 모드 여부 업데이트
        const isCountUp = ['진료중', '상담중', '대기중', '검사중', '안내중'].includes(label);
        roomTimers[room].isCountUp = isCountUp;
        
        console.log(`🏷️ ${room} 라벨 업데이트: ${oldLabel} → ${label} (카운트업: ${isCountUp})`);
        
        // 클라이언트에 상태 전송
        io.emit('timerState', { room, state: { ...roomTimers[room] } });
        
        // 라벨 변경 시 즉시 Airtable 업데이트
        if (roomNames[room] && roomNames[room].trim()) {
            const recordId = roomRecordIds[room];
            if (recordId) {
                try {
                    await updateNewLabelStatus(recordId, label);
                    
                    // Airtable 수납 테이블 업데이트
                    const treatmentInfo = label ? `${label} 진행중` : '';
                    const patientKeyForOrder = getPatientKeyForRoom(room);
                    if (patientKeyForOrder) {
                        try {
                            await updateAirtablePayment(recordId, treatmentInfo, false); // 진행 중인 치료
                            console.log(`✅ 라벨 변경 후 Airtable 업데이트 성공: ${room} - ${treatmentInfo}`);
                        } catch (error) {
                            console.error(`❌ 라벨 변경 후 Airtable 업데이트 실패: ${room}`, error);
                        }
                    }
                } catch (error) {
                    console.error(`❌ 라벨 업데이트 실패: ${room}`, error);
                }
            }
        }
    });

    // 침 갯수 저장 이벤트
    socket.on('saveNeedleCount', async ({ room, needleCount }) => {
        if (!ROOM_NAMES.includes(room)) return;
        
        if (roomNames[room] && roomNames[room].trim()) {
            const recordId = roomRecordIds[room];
            if (recordId) {
                try {
                    await new Promise((resolve, reject) => {
                        safeAirtableUpdate(recordId, {
                            '침갯수': needleCount
                        }, (err, record) => {
                            if (err) {
                                console.error(`❌ 침 갯수 Airtable 업데이트 실패: ${room}`, err);
                                reject(err);
                            } else {
                                console.log(`✅ 침 갯수 Airtable 업데이트 성공: ${room} - ${needleCount}개`);
                                resolve(record);
                            }
                        });
                    });
                    
                    socket.emit('needleCountSaved', { room, needleCount, success: true });
                } catch (error) {
                    console.error(`❌ 침 갯수 저장 실패: ${room}`, error);
                    socket.emit('needleCountSaved', { room, needleCount, success: false });
                }
            } else {
                socket.emit('needleCountSaved', { room, needleCount, success: false });
            }
        } else {
            socket.emit('needleCountSaved', { room, needleCount, success: false });
        }
    });

    // 진료끝 이벤트
    socket.on('endTreatment', async ({ room }) => {
        if (!ROOM_NAMES.includes(room)) return;
        
        console.log(`🏥 진료끝 요청: ${room}`);
        
        if (roomNames[room] && roomNames[room].trim()) {
            const recordId = roomRecordIds[room];
            if (recordId) {
                try {
                    // Airtable에서 해당 레코드를 가져와서 "진끝" 필드를 true로 설정
                    const airtable = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
                    if (base && AIRTABLE_TABLE_NAME) {
                        await new Promise((resolve, reject) => {
                            base(AIRTABLE_TABLE_NAME).update(recordId, {
                                '진끝': true
                            }, (err, record) => {
                                if (err) {
                                    console.error(`❌ 진끝 Airtable 업데이트 실패: ${room}`, err);
                                    reject(err);
                                } else {
                                    console.log(`✅ 진끝 Airtable 업데이트 성공: ${room}`);
                                    resolve(record);
                                }
                            });
                        });
                    }
                    
                    await updateAirtablePayment(recordId, '', false);
                    console.log(`✅ 진료끝 시 Airtable 비고(순서) 필드 비움: ${room}`);
                    
                    // 방 상태 초기화
                    roomNames[room] = '';
                    roomOccupied[room] = false;
                    resetTreatmentOrderCache(room);
                    
                    if (roomTimers[room]) {
                        roomTimers[room].isRunning = false;
                        roomTimers[room].timeLeft = 0;
                        roomTimers[room].duration = 0;
                        roomTimers[room].label = '';
                        roomTimers[room].isCountUp = false;
                        roomTimers[room].wasRunning = false;
                    }
                    
                    // 클라이언트에 업데이트 전송
                    io.emit('namesRefreshed', { names: roomNames, occupied: roomOccupied });
                    io.emit('nameUpdate', { room, name: '', recordId: null });
                    io.emit('timerState', { room, state: { ...roomTimers[room] } });
                    
                    console.log(`✅ 진료끝 처리 완료: ${room}`);
                } catch (error) {
                    console.error(`❌ 진료끝 처리 실패: ${room}`, error);
                }
            } else {
                console.log(`⚠️ ${room}에 환자 정보가 없음`);
            }
        }
    });

    socket.on('refreshNames', async () => {
        console.log('🔄 이름 새로고침 요청 받음');
        
        try {
            // Socket.IO에서 세션 접근
            const session = socket.request.session;
            const dataSheetId = session?.dataSheetId;
            
            let data;
            
            // Google Sheets가 설정되어 있으면 우선 사용
            if (dataSheetId) {
                console.log('📊 Google Sheets에서 환자 목록 조회 시도');
                data = await fetchPatientsFromGoogleSheets(dataSheetId, ROOM_NAMES);
                console.log('📊 Google Sheets에서 가져온 이름:', data);
            } else {
                // Google Sheets가 없으면 기존 방식 사용
                console.log('📡 기존 서버에서 이름 데이터 요청');
                data = await fetchNamesFromAirtable();
                console.log('📊 기존 서버에서 가져온 이름:', data);
            }
            
            // names 객체에서 이름 데이터 추출
            const names = data.names || data;
            
            // 모든 방의 이름을 먼저 초기화
            ROOM_NAMES.forEach(room => {
                roomNames[room] = '';
                roomOccupied[room] = false;
            });
            
            // 받은 데이터로 업데이트
            Object.keys(names).forEach(room => {
                roomNames[room] = names[room] || '';
                // 이름이 있으면 점유 중, 없으면 빈 방
                roomOccupied[room] = !!(names[room] && names[room].trim());
            });
            
            // 클라이언트에 이름과 점유 상태 전송
            console.log('📤 클라이언트에 전송할 데이터:', { names: roomNames, occupied: roomOccupied });
            socket.emit('namesRefreshed', { names: roomNames, occupied: roomOccupied });
            
            // Airtable 체크박스 상태에 따른 라벨 업데이트 (기존 방식 유지 - Google Sheets 사용 시에는 생략)
            if (!dataSheetId) {
                console.log('🔍 체크박스 상태 즉시 확인 중...');
                for (const room of ROOM_NAMES) {
                    if (roomRecordIds[room]) {
                        await updateLabelFromAirtableCheckboxes(roomRecordIds[room], room);
                    }
                }
            }
        } catch (err) {
            console.error('❌ 이름 가져오기 실패:', err);
            // 실패 시 현재 저장된 이름이라도 보내기
            console.log('📤 실패 시 전송할 데이터:', roomNames);
            socket.emit('namesRefreshed', { names: roomNames, occupied: roomOccupied });
        }
    });

    socket.on('disconnect', () => {
        console.log('사용자 연결 해제');
    });
});

// 타이머 카운트다운 처리
setInterval(() => {
    ROOM_NAMES.forEach(room => {
        const timer = roomTimers[room];
        if (!timer) return;
        
        if (timer.isRunning) {
            if (timer.isCountUp) {
                // 카운트업 모드: 시간 증가
                timer.timeLeft++;
            } else {
                // 일반 모드: 시간 감소
                timer.timeLeft--;
                
                // 시간이 0이 되면 종료
                if (timer.timeLeft <= 0) {
                    timer.timeLeft = 0;
                    timer.isRunning = false;
                    timer.wasRunning = true;
                    
                    console.log(`⏰ ${room} 타이머 종료!`);
                    
                    // 클라이언트에 종료 이벤트 전송
                    io.emit('timerEnded', { room });
                    io.emit('timerState', { room, state: { ...timer } });
                    
                    // Slack 알림 기능 제거됨
                }
            }
            
            // 상태 전송 (1초마다)
            io.emit('timerState', { room, state: { ...timer } });
        }
    });
}, 1000);

// 1분마다 Airtable에서 이름 데이터 가져오기 (폴링)
setInterval(async () => {
    try {
        const data = await fetchNamesFromAirtable();
        console.log('📊 1분 폴링 - Airtable에서 가져온 이름:', data);
        
        const names = data.names || data;
        
        // 환자가 있는 방만 타이머 상태 Airtable 업데이트
        Object.keys(names).forEach(async (room) => {
            if (names[room] && names[room].trim()) {
                const recordId = roomRecordIds[room];
                if (recordId) {
                    try {
                        const record = await getAirtableRecord(recordId);
                        const fields = record.fields;
                        
                        console.log(`🧾 1분 폴링 - ${room} Airtable 필드 확인:`, {
                            원시: fields['원시'],
                            원끝: fields['원끝'],
                            침: fields['침'],
                            침종료: fields['침종료'],
                            부항: fields['부항'],
                            부항종료: fields['부항종료'],
                            뜸: fields['뜸'],
                            뜸종료: fields['뜸종료'],
                            검시: fields['검시'],
                            검끝: fields['검끝'],
                            안시: fields['안시'],
                            안끝: fields['안끝']
                        });
                        
                        // 모든 타이머 상태 Airtable 업데이트
                        const timer = roomTimers[room];
                        if (timer && timer.isRunning && timer.label) {
                            const label = timer.label.trim();
                            const remainingMinutes = Math.floor(timer.timeLeft / 60);
                            const remainingSeconds = timer.timeLeft % 60;
                            const statusWithTime = `${label} ${remainingMinutes}분 ${remainingSeconds}초 남음`;
                            
                            console.log(`📝 1분 폴링 - ${room} ${label} 상태 Airtable 업데이트`);
                            
                            if (label === '안내중') {
                                // 안시 체크박스 업데이트
                                await new Promise((resolve, reject) => {
                                    safeAirtableUpdate(recordId, {
                                        '안시': true,
                                        '안끝': false
                                    }, (err, record) => {
                                        if (err) {
                                            console.error(`❌ 1분 폴링 - 안시 체크박스 업데이트 실패:`, err);
                                            reject(err);
                                        } else {
                                            console.log(`✅ 1분 폴링 - 안시 체크박스 업데이트 완료`);
                                            resolve(record);
                                        }
                                    });
                                });
                            } else {
                                // 다른 라벨들은 체크박스 업데이트
                                await updateNewLabelStatus(recordId, label);
                            }
                            
                            await updateAirtablePayment(recordId, statusWithTime, false);
                            console.log(`📝 1분 폴링 - ${room} ${label} 타이머 Airtable 업데이트: ${remainingMinutes}분 ${remainingSeconds}초 남음 (timeLeft: ${timer.timeLeft})`);
                        } else {
                            // 타이머가 실행 중이 아니면 비고(순서) 필드 비움
                            await updateAirtablePayment(recordId, '', false);
                        }
                    } catch (fieldErr) {
                        console.error(`❌ 1분 폴링 - ${room} Airtable 필드 조회 실패:`, fieldErr);
                    }
                }
            }
        });
    } catch (error) {
        console.error('❌ 1분 폴링 중 방 점유 상태 확인 실패:', error);
    }
}, 60000); // 1분(60000ms)마다 실행


const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

