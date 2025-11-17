const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const dotenv = require('dotenv');
const Airtable = require('airtable');

dotenv.config(); // 👈 반드시 상단에서 호출

// Airtable 설정 - .env에서 가져오기
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    allowEIO3: true
});


app.use(express.static('public'));
app.use(express.json()); // JSON 파싱을 위한 미들웨어 추가

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

// 개별 방 화면용 동적 라우트
app.get('/room/:roomName', (req, res) => {
    const roomName = decodeURIComponent(req.params.roomName);
    
    // 유효한 방 이름인지 확인
    if (!ROOM_NAMES.includes(roomName)) {
        return res.status(404).send('존재하지 않는 방입니다.');
    }
    
    // room.html 파일 전송
    res.sendFile(__dirname + '/public/room.html');
});

// 문 앞 태블릿용 화면 라우트
app.get('/room2/:roomName', (req, res) => {
    const roomName = decodeURIComponent(req.params.roomName);

    if (!ROOM_NAMES.includes(roomName)) {
        return res.status(404).send('존재하지 않는 방입니다.');
    }

    res.sendFile(__dirname + '/public/room2.html');
});

// 방별 치료 진행 상황 조회 API
app.get('/api/room/:roomName/treatment-status', async (req, res) => {
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
                inProgress: (!isChecked('원끝') && (isChecked('원시') || textEquals('원상', '진료중'))) || activeTimerLabel === '진료중'
            },
            침: {
                completed: isChecked('침종료'),
                inProgress: (!isChecked('침종료') && (isChecked('침') || activeTimerLabel === '침')) || activeTimerLabel === '침'
            },
            부항: {
                completed: isChecked('부항종료'),
                inProgress: (!isChecked('부항종료') && (isChecked('부항') || activeTimerLabel === '부항')) || activeTimerLabel === '부항'
            },
            뜸: {
                completed: isChecked('뜸종료'),
                inProgress: (!isChecked('뜸종료') && (isChecked('뜸') || activeTimerLabel === '뜸')) || activeTimerLabel === '뜸'
            },
            검사중: {
                completed: isChecked('검끝'),
                inProgress: (!isChecked('검끝') && (isChecked('검시') || activeTimerLabel === '검사중')) || activeTimerLabel === '검사중'
            },
            안내중: {
                completed: isChecked('안끝'),
                inProgress: (!isChecked('안끝') && (isChecked('안시') || activeTimerLabel === '안내중')) || activeTimerLabel === '안내중'
            }
        };

        if (hasPsychology) {
            treatmentStatus.심상 = {
                completed: isChecked('심끝') || textEquals('심상', '완료'),
                inProgress: (!isChecked('심끝') && (isChecked('심시') || textEquals('심상', '상담중') || activeTimerLabel === '상담중')) || activeTimerLabel === '상담중'
            };
        }

        Object.keys(treatmentStatus).forEach(key => {
            treatmentStatus[key].sequence = sequences[key] ?? null;
            treatmentStatus[key].startedAt = startTimes[key] || null;
            treatmentStatus[key].finishedAt = endTimes[key] || null;
        });

        console.log(`🔍 ${roomName} 치료 상태 분석:`, {
            원상: treatmentStatus.원상,
            침: treatmentStatus.침,
            부항: treatmentStatus.부항,
            뜸: treatmentStatus.뜸,
            심상: treatmentStatus.심상,
            검사중: treatmentStatus.검사중,
            안내중: treatmentStatus.안내중
        });

        console.log('🧾 Airtable 원본 필드 값:', {
            '원시': fields['원시'],
            '원끝': fields['원끝'],
            '원상': fields['원상'],
            '침': fields['침'],
            '침종료': fields['침종료'],
            '부항': fields['부항'],
            '부항종료': fields['부항종료'],
            '뜸': fields['뜸'],
            '뜸종료': fields['뜸종료'],
            '검시': fields['검시'],
            '검끝': fields['검끝'],
            '안시': fields['안시'],
            '안끝': fields['안끝'],
            '심시': fields['심시'],
            '심끝': fields['심끝'],
            '심상': fields['심상']
        });

        res.json({
            room: roomName,
            patientName: roomNames[roomName] || '',
            doctorName,
            counselorName,
            needleCount,
            hasPatient: !!(roomNames[roomName] && roomNames[roomName].trim()),
            treatmentStatus
        });
    } catch (error) {
        console.error('❌ 치료 진행 상황 조회 실패:', error);
        res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
});

// 각 방별 타이머 상태
let roomTimers = {};
let roomNames = {};
let roomRecordIds = {}; // recordIds 저장용
let roomOccupied = {}; // 방 점유 상태 (진끝 체크박스 기준)
let treatmentOrderCache = {};

ROOM_NAMES.forEach(room => {
    roomTimers[room] = {
        isRunning: false,
        timeLeft: 0,
        startTime: 0,
        wasRunning: false, // 알림 효과를 위한 플래그
        label: '', // 라벨 정보 추가
        duration: 0, // 추가된 필드
        isCountUp: false // 카운트업 모드 여부 (진료중/상담중/대기중용)
    };
    roomNames[room] = '';
    roomOccupied[room] = false; // 기본적으로 빈 방
    treatmentOrderCache[room] = createEmptyTreatmentOrderCache();
});

function createEmptyTreatmentOrderCache() {
    return {
        patientKey: '',
        entries: {},
        sequenceCounter: 0,
        orderLog: []
    };
}

function resetTreatmentOrderCache(room) {
    treatmentOrderCache[room] = createEmptyTreatmentOrderCache();
}

function getPatientKeyForRoom(room) {
    if (!room) return '';
    const recordId = roomRecordIds[room];
    if (recordId) return recordId;
    const name = roomNames[room];
    if (name && name.trim()) {
        return `${room}-${name.trim()}`;
    }
    return '';
}

function ensureTreatmentOrderEntry(room, patientKey, statusKey) {
    if (!room || !patientKey || !statusKey) return null;
    if (!treatmentOrderCache[room]) {
        treatmentOrderCache[room] = createEmptyTreatmentOrderCache();
    }
    const cache = treatmentOrderCache[room];
    if (cache.patientKey !== patientKey) {
        cache.patientKey = patientKey;
        cache.entries = {};
        cache.sequenceCounter = 0;
        cache.orderLog = [];
    }
    if (!cache.entries[statusKey]) {
        cache.entries[statusKey] = {
            startTime: null,
            endTime: null,
            assignedOrder: null,
            source: 'server'
        };
    }
    return cache.entries[statusKey];
}

function recordTreatmentStart(room, patientKey, statusKey, timestamp) {
    if (!room || !patientKey || !statusKey) return;
    if (!Number.isFinite(timestamp)) {
        timestamp = Date.now();
    }
    const cache = treatmentOrderCache[room];
    if (!cache || cache.patientKey !== patientKey) return;

    const entry = ensureTreatmentOrderEntry(room, patientKey, statusKey);
    if (!entry) return;

    // 서버 시간은 항상 덮어쓰기 (버튼 클릭 순서가 정확해야 함)
    if (!Number.isFinite(entry.startTime) || entry.source !== 'server') {
        entry.startTime = timestamp;
    }
    
    // 순번도 서버에서 처음 기록할 때만 할당
    if (!Number.isFinite(entry.assignedOrder) || entry.source !== 'server') {
        cache.sequenceCounter += 1;
        entry.assignedOrder = cache.sequenceCounter;
    }
    entry.endTime = null;
    
    entry.source = 'server';
    cache.orderLog.push({
        statusKey,
        assignedOrder: entry.assignedOrder,
        timestamp
    });

    console.log('🕒 치료 순서 기록', {
        room,
        patientKey,
        statusKey,
        assignedOrder: entry.assignedOrder,
        isoTime: new Date(entry.startTime).toISOString()
    });
}

function recordTreatmentCompletion(room, patientKey, statusKey, timestamp) {
    if (!room || !patientKey || !statusKey) return;
    if (!Number.isFinite(timestamp)) {
        timestamp = Date.now();
    }
    const cache = treatmentOrderCache[room];
    if (!cache || cache.patientKey !== patientKey) return;

    const entry = ensureTreatmentOrderEntry(room, patientKey, statusKey);
    if (!entry) return;

    entry.endTime = timestamp;
    entry.source = 'server';
    cache.orderLog.push({
        statusKey,
        assignedOrder: entry.assignedOrder,
        timestamp
    });

    console.log('🕒 치료 완료 기록', {
        room,
        patientKey,
        statusKey,
        isoTime: new Date(entry.endTime).toISOString()
    });
}

function updateTreatmentOrderCache(room, patientKey, fields = {}) {
    if (!room) return;
    if (!treatmentOrderCache[room]) {
        treatmentOrderCache[room] = createEmptyTreatmentOrderCache();
    }

    const normalizedKey = patientKey || '';
    const cache = treatmentOrderCache[room];

    if (!normalizedKey) {
        return cache;
    }

    if (cache.patientKey !== normalizedKey) {
        cache.patientKey = normalizedKey;
        cache.entries = {};
        cache.sequenceCounter = 0;
        cache.orderLog = [];
    }

    return cache;
}

function getTreatmentOrderSnapshot(room) {
    const cache = treatmentOrderCache[room];
    if (!cache) {
        return { sequences: {}, startTimes: {} };
    }

    const items = Object.entries(cache.entries).map(([key, entry]) => ({
        key,
        startTime: Number.isFinite(entry.startTime) ? entry.startTime : null,
        endTime: Number.isFinite(entry.endTime) ? entry.endTime : null,
        assignedOrder: entry.assignedOrder ?? Number.MAX_SAFE_INTEGER,
        source: entry.source || 'unknown'
    }));

    // 서버에서 기록한 항목이 항상 우선, 그 다음 서버 시간으로 정렬
    items.sort((a, b) => {
        const aIsServer = a.source === 'server';
        const bIsServer = b.source === 'server';
        
        // 서버 기록 항목이 항상 먼저
        if (aIsServer && !bIsServer) return -1;
        if (!aIsServer && bIsServer) return 1;
        
        // 둘 다 서버 기록이면 시간 순서대로
        if (aIsServer && bIsServer) {
            if (Number.isFinite(a.startTime) && Number.isFinite(b.startTime)) {
                return a.startTime - b.startTime;
            }
            // 시간이 없으면 assignedOrder로
            return a.assignedOrder - b.assignedOrder;
        }
        
        // 둘 다 서버 기록이 아니면 assignedOrder로 (fallback)
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

// Replace hardcoded token with environment variable
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// 기존 서버와 Socket.IO 연결
const existingServerSocket = require('socket.io-client')('http://192.168.219.190:3002');

// 기존 서버에서 이름 데이터를 가져오는 함수
async function fetchNamesFromAirtable() {
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

// Airtable 수납 테이블 업데이트 함수 (진행 중인 치료는 업데이트, 완료된 치료는 추가)
async function updateAirtablePayment(recordId, treatmentInfo, isCompleted = false) {
    try {
        console.log(`📝 Airtable 수납 테이블 업데이트: recordId=${recordId}, treatmentInfo=${treatmentInfo}, isCompleted=${isCompleted}`);
        
        return new Promise((resolve, reject) => {
            // 기존 내용을 지우고 새롭게 업데이트
            base(AIRTABLE_TABLE_NAME).update(recordId, {
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

// Airtable에서 기존 데이터 확인 함수
async function getAirtableRecord(recordId) {
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

// Airtable 치료별 시간 기록 함수 (침 2차 기록 지원)
async function updateTreatmentTime(recordId, treatmentType, timeValue) {
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
            
            base(AIRTABLE_TABLE_NAME).update(recordId, updateData, (err, record) => {
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
async function checkRoomOccupied(recordId) {
    try {
        const record = await getAirtableRecord(recordId);
        const fields = record.fields;
        console.log(`🔍 진끝 상태 확인 - recordId: ${recordId}, fields:`, fields);
        console.log(`🔍 진끝 필드 값: ${fields['진끝']}, 타입: ${typeof fields['진끝']}`);
        // 진끝 체크박스가 true이면 방이 비어있음, false이면 점유 중
        const isOccupied = !fields['진끝'];
        console.log(`🔍 점유 상태: ${isOccupied ? '점유 중' : '빈 방'}`);
        return isOccupied;
    } catch (error) {
        console.error('❌ 진끝 상태 확인 실패:', error.message);
        return false; // 에러 시 기본적으로 빈 방으로 처리
    }
}

// Airtable 체크박스 변경에 따른 라벨 업데이트 함수
async function updateLabelFromAirtableCheckboxes(recordId, room) {
    try {
        const record = await getAirtableRecord(recordId);
        const fields = record.fields;
        console.log(`🔍 Airtable 체크박스 상태 확인 - recordId: ${recordId}, room: ${room}, fields:`, fields);
        
        let newLabel = '';
        let shouldUpdate = false;
        
        // 원시 체크박스 true이고 원끝 체크박스 false이면 진료중
        if (fields['원시'] === true && fields['원끝'] === false) {
            newLabel = '진료중';
            shouldUpdate = true;
            console.log(`✅ ${room} - 원시:true, 원끝:false → 진료중으로 설정`);
        }
        // 심시 체크박스 true이고 심끝 체크박스 false이면 상담중
        else if (fields['심시'] === true && fields['심끝'] === false) {
            newLabel = '상담중';
            shouldUpdate = true;
            console.log(`✅ ${room} - 심시:true, 심끝:false → 상담중으로 설정`);
        }
        // 원시나 심시가 false이거나 원끝/심끝이 true이면 라벨 초기화
        else if ((fields['원시'] === false || fields['원끝'] === true) && 
                 (fields['심시'] === false || fields['심끝'] === true)) {
            newLabel = '';
            shouldUpdate = true;
            console.log(`✅ ${room} - 체크박스 상태에 따라 라벨 초기화`);
        }
        // 그 외의 경우는 라벨 변경하지 않음
        else {
            console.log(`⚠️ ${room} - 체크박스 상태에 따른 라벨 변경 없음`);
            return;
        }
        
        // 타이머 상태 업데이트 (라벨이 변경된 경우에만)
        if (roomTimers[room] && shouldUpdate) {
            const oldLabel = roomTimers[room].label;
            roomTimers[room].label = newLabel;
            
            // 카운트업 모드 여부 업데이트
            const isCountUp = ['진료중', '상담중', '대기중', '검사중', '안내중'].includes(newLabel);
            roomTimers[room].isCountUp = isCountUp;
            
            console.log(`✅ ${room} 타이머 라벨 업데이트: ${oldLabel} → ${newLabel} (카운트업: ${isCountUp})`);
            
            // 클라이언트에 업데이트된 상태 전송
            io.emit('timerState', { room, state: { ...roomTimers[room] } });
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
            
            base(AIRTABLE_TABLE_NAME).update(recordId, updateData, (err, record) => {
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
        
        return new Promise((resolve, reject) => {
            const updateData = {};
            
            if (label === '진료중') {
                updateData['원시'] = true;  // 원시 체크박스 true
                updateData['원끝'] = false; // 원끝 체크박스 false
                updateData['원상'] = '진료중'; // 원상 필드를 진료중으로 설정
            } else if (label === '상담중') {
                updateData['심시'] = true;  // 심시 체크박스 true
                updateData['심끝'] = false; // 심끝 체크박스 false
                updateData['심상'] = '상담중'; // 심상 필드를 상담중으로 설정
            } else if (label === '대기중') {
                updateData['비고(순서)'] = '대기중'; // 비고(순서) 필드에 대기중
                // 체크박스는 플래그로 처리
            }
            
            if (Object.keys(updateData).length === 0) {
                console.log(`⚠️ 알 수 없는 라벨 타입: ${label}`);
                resolve();
                return;
            }
            
            base(AIRTABLE_TABLE_NAME).update(recordId, updateData, (err, record) => {
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

io.on('connection', async (socket) => {
    console.log('========================================');
    console.log('🔌 새로운 클라이언트 연결! Socket ID:', socket.id);
    console.log('========================================');
    
    // 접속 시 자동으로 최신 데이터 가져오기 (F5 효과)
    try {
        console.log('🔄 F5 효과 - 자동 이름 새로고침 실행');
        const data = await fetchNamesFromAirtable();
        console.log('📊 F5 효과 - Airtable에서 가져온 이름:', data);
        
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
        
        // Airtable 체크박스 상태에 따른 라벨 업데이트
        ROOM_NAMES.forEach(room => {
            if (roomRecordIds[room]) {
                updateLabelFromAirtableCheckboxes(roomRecordIds[room], room);
            }
        });
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


    // 타이머 시작
    socket.on('startTimer', async ({ room, duration, force, label, checkWonEnd, checkSimEnd, checkTestEnd, checkCostEnd }) => {
        console.log(`🔥 startTimer received: room=${room}, duration=${duration}, force=${force}, label=${label}`);
        if (!roomTimers[room]) return;
        
        // 치료 라벨인지 확인 (침, 뜸, 부항)
        const isTreatmentLabel = ['침', '뜸', '부항'].includes(label);
        
        // 치료 라벨이면 force 조건 무시 (진료중에서 치료로 전환 허용)
        if (!force && roomTimers[room].isRunning && !isTreatmentLabel) return;
        
        // 디버깅: 현재 상태 로그
        console.log(`🔍 디버깅 - ${room}: isTreatmentLabel=${isTreatmentLabel}, isRunning=${roomTimers[room].isRunning}, isCountUp=${roomTimers[room].isCountUp}, label=${roomTimers[room].label}`);
        
        // 현재 진료중 카운트업 상태이고 치료 라벨이 시작되는 경우, 진료 종료 처리
        if (isTreatmentLabel && roomTimers[room].isRunning && roomTimers[room].isCountUp && roomTimers[room].label === '진료중') {
            console.log(`🏥 진료 종료 처리: ${room} - ${roomTimers[room].label}에서 ${label} 치료 시작`);
            
        // 진료 종료 시간 기록
        // 완료 시간을 먼저 기록하고 즉시 클라이언트에 전송
        const now = new Date();
        const completionTimestamp = now.getTime();
        const endTimeForAirtable = now.toISOString();

        const patientKeyForOrder = getPatientKeyForRoom(room);
        const statusKeyForCompletion = TIMER_LABEL_TO_STATUS_KEY[currentLabel];
        if (patientKeyForOrder && statusKeyForCompletion) {
            recordTreatmentCompletion(room, patientKeyForOrder, statusKeyForCompletion, completionTimestamp);
        }
        
        // 즉시 클라이언트에 완료 이벤트 전송 (Airtable 업데이트 전에)
        io.emit('doneAlarm', { room, label: currentLabel, finishedAt: endTimeForAirtable });
            
            if (roomNames[room] && roomNames[room].trim()) {
                const recordId = roomRecordIds[room];
                if (recordId) {
                    try {
                        // 원끝 체크박스 업데이트
                        await new Promise((resolve, reject) => {
                            base(AIRTABLE_TABLE_NAME).update(recordId, {
                                '원끝': true
                            }, (err, record) => {
                                if (err) {
                                    console.error('❌ 원끝 체크박스 업데이트 실패:', err);
                                    reject(err);
                                } else {
                                    console.log('✅ 원끝 체크박스 업데이트 완료');
                                    resolve(record);
                                }
                            });
                        });
                        

                            
                    } catch (error) {
                        console.error(`❌ 진료 종료 처리 실패: ${room}`, error);
                    }
                }
            }
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
        
        // 치료 정보 생성 (카운트업 모드와 일반 모드 구분)
        let treatmentInfo = '';
        if (isCountUp) {
            treatmentInfo = `${finalLabel || '상태'}`;
        } else {
            const minutes = Math.floor(duration / 60);
            treatmentInfo = `${finalLabel || '치료'} ${minutes}분 남음`;
        }
        
        // '대기중'으로 바뀔 때 blink 해제를 위해 timerState를 한 번 emit
        if (isCountUp && finalLabel === '대기중') {
            io.emit('timerState', { room, state: { ...roomTimers[room], isRunning: false, wasRunning: false, timeLeft: 0, label: '대기중', isCountUp: true } });
        }
        roomTimers[room] = {
            isRunning: true,
            duration: isCountUp ? 0 : duration, // 카운트업 모드면 duration은 0
            timeLeft: (isCountUp && finalLabel === '대기중') ? 0 : (isCountUp ? 0 : duration), // 대기중 카운트업이면 0, 그 외는 기존대로
            startTime: Date.now(),
            wasRunning: false,
            label: finalLabel,
            isCountUp: isCountUp // 카운트업 모드 설정
        };

        if (patientKeyForOrder) {
            const statusKey = TIMER_LABEL_TO_STATUS_KEY[finalLabel];
            if (statusKey) {
                recordTreatmentStart(room, patientKeyForOrder, statusKey, Date.now());
            }
        }
        
        // Airtable 수납 테이블 업데이트
        let stateUpdated = false;
        if (roomNames[room] && roomNames[room].trim()) {
            const recordId = roomRecordIds[room];
            if (recordId) {
                try {
                    await updateAirtablePayment(recordId, treatmentInfo, false); // 진행 중인 치료
                    console.log(`✅ Airtable 업데이트 성공: ${room} - ${treatmentInfo}`);
                    
                    // 치료별 시작 시간 기록 (카운트업 모드가 아닐 때만)
                    if (!isCountUp) {
                        const treatmentLabel = finalLabel || '치료';
                        let treatmentType = '';
                        if (treatmentLabel === '침') {
                            treatmentType = '침시작';
                        } else if (treatmentLabel === '부항') {
                            treatmentType = '부항시작';
                        } else if (treatmentLabel === '뜸') {
                            treatmentType = '뜸시작';
                        }
                        
                        if (treatmentType) {
                            await updateTreatmentTime(recordId, treatmentType, startTimeForAirtable);
                            console.log(`✅ ${treatmentType} 시간 기록 성공: ${startTimeForAirtable}`);
                        }
                        
                        // 치료 체크박스 업데이트 (치료 시작할 때)
                        try {
                            await updateTreatmentCheckbox(recordId, treatmentLabel);
                            console.log(`✅ ${treatmentLabel} 체크박스 업데이트 완료 (치료 시작)`);
                        } catch (error) {
                            console.error(`❌ ${treatmentLabel} 체크박스 업데이트 실패:`, error);
                        }
                    }
                    // 검사중 시작 시 검사시작 필드 기록
                    if (finalLabel === '검사중') {
                        try {
                            await updateTreatmentTime(recordId, '검사시작', startTimeForAirtable);
                            console.log(`✅ 검사시작 시간 기록 성공: ${startTimeForAirtable}`);
                        } catch (error) {
                            console.error('❌ 검사시작 시간 기록 실패:', error);
                        }
                        // 검사중 시작 시 검시 체크박스 true로 업데이트
                        try {
                            await new Promise((resolve, reject) => {
                                base(AIRTABLE_TABLE_NAME).update(recordId, {
                                    '검시': true
                                }, (err, record) => {
                                    if (err) {
                                        console.error('❌ 검시 체크박스 업데이트 실패:', err);
                                        reject(err);
                                    } else {
                                        console.log('✅ 검시 체크박스 업데이트 완료 (검사중 시작)');
                                        resolve(record);
                                    }
                                });
                            });
                        } catch (error) {
                            console.error('❌ 검시 체크박스 업데이트 실패:', error);
                        }
                    }
                    
                    if (isCountUp && finalLabel === '진료중') {
                        try {
                            await updateTreatmentTime(recordId, '원시시간', startTimeForAirtable);
                            console.log(`✅ 원시시간 기록 완료: ${startTimeForAirtable}`);
                        } catch (error) {
                            console.error('❌ 원시시간 기록 실패:', error);
                        }
                    } else if (isCountUp && finalLabel === '상담중') {
                        try {
                            await updateTreatmentTime(recordId, '심시시간', startTimeForAirtable);
                            console.log(`✅ 심시시간 기록 완료: ${startTimeForAirtable}`);
                        } catch (error) {
                            console.error('❌ 심시시간 기록 실패:', error);
                        }
                    }
                    
                    // 새로운 라벨 상태 업데이트 (진료중, 상담중, 대기중, 안내중)
                    try {
                        if (finalLabel === '진료중' || finalLabel === '상담중' || finalLabel === '대기중') {
                            await updateNewLabelStatus(recordId, finalLabel);
                            console.log(`✅ ${finalLabel} 새로운 라벨 상태 업데이트 완료 (치료 시작)`);
                        } else if (finalLabel === '안내중') {
                            // 안내중 시작 시 안내시작 시간 기록
                            try {
                                await updateTreatmentTime(recordId, '안내시작', startTimeForAirtable);
                                console.log(`✅ 안내시작 시간 기록 완료: ${startTimeForAirtable}`);
                            } catch (error) {
                                console.error('❌ 안내시작 시간 기록 실패:', error);
                            }
                            // 안내중 시작 시 안시 true, 안끝 false
                            await new Promise((resolve, reject) => {
                                base(AIRTABLE_TABLE_NAME).update(recordId, {
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
                        }
                    } catch (error) {
                        console.error(`❌ ${finalLabel} 새로운 라벨 상태 업데이트 실패:`, error);
                    }
                    
                    // 대기중 체크박스 특별 처리
                    if (checkWonEnd) {
                        try {
                            await new Promise((resolve, reject) => {
                                base(AIRTABLE_TABLE_NAME).update(recordId, {
                                    '원끝': true
                                }, (err, record) => {
                                    if (err) {
                                        console.error('❌ 원끝 체크박스 업데이트 실패:', err);
                                        reject(err);
                                    } else {
                                        console.log('✅ 원끝 체크박스 업데이트 완료 (1_hold)');
                                        resolve(record);
                                    }
                                });
                            });
                        } catch (error) {
                            console.error('❌ 원끝 체크박스 업데이트 실패:', error);
                        }
                    }
                    
                    if (checkSimEnd) {
                        try {
                            await new Promise((resolve, reject) => {
                                base(AIRTABLE_TABLE_NAME).update(recordId, {
                                    '심끝': true
                                }, (err, record) => {
                                    if (err) {
                                        console.error('❌ 심끝 체크박스 업데이트 실패:', err);
                                        reject(err);
                                    } else {
                                        console.log('✅ 심끝 체크박스 업데이트 완료 (2_hold)');
                                        resolve(record);
                                    }
                                });
                            });
                        } catch (error) {
                            console.error('❌ 심끝 체크박스 업데이트 실패:', error);
                        }
                    }
                    
                    if (checkTestEnd) {
                        // 검끝 체크박스 true로 업데이트
                        try {
                            await new Promise((resolve, reject) => {
                                base(AIRTABLE_TABLE_NAME).update(recordId, {
                                    '검끝': true
                                }, (err, record) => {
                                    if (err) {
                                        console.error('❌ 검끝 체크박스 업데이트 실패:', err);
                                        reject(err);
                                    } else {
                                        console.log('✅ 검끝 체크박스 업데이트 완료 (검사완료)');
                                        resolve(record);
                                    }
                                });
                            });
                        } catch (error) {
                            console.error('❌ 검끝 체크박스 업데이트 실패:', error);
                        }
                    }

                    if (checkCostEnd) {
                        try {
                            await new Promise((resolve, reject) => {
                                base(AIRTABLE_TABLE_NAME).update(recordId, {
                                    '안끝': true
                                }, (err, record) => {
                                    if (err) {
                                        console.error('❌ 안끝 체크박스 업데이트 실패:', err);
                                        reject(err);
                                    } else {
                                        console.log('✅ 안끝 체크박스 업데이트 완료 (비용설명/안내 끝)');
                                        resolve(record);
                                    }
                                });
                            });
                        } catch (error) {
                            console.error('❌ 안끝 체크박스 업데이트 실패:', error);
                        }
                    }

                } catch (error) {
                    console.error(`❌ Airtable 업데이트 실패: ${room}`, error);
                }
            } else {
                console.log(`⚠️ ${room}의 recordId를 찾을 수 없음`);
            }
        }
        
        io.emit('timerState', { room, state: roomTimers[room] });
    });

    // 타이머 리셋
    socket.on('resetTimer', async ({ room }) => {
        if (!roomTimers[room]) return;
        
        // Airtable 수납 테이블 업데이트 (비고(순서) 필드 비움)
        if (roomNames[room] && roomNames[room].trim()) {
            const recordId = roomRecordIds[room];
            if (recordId) {
                try {
                    // 리셋 시 비고(순서) 필드를 비움
                    await updateAirtablePayment(recordId, '', false);
                    console.log(`✅ 타이머 리셋 후 Airtable 비고(순서) 필드 비움: ${room}`);
                } catch (error) {
                    console.error(`❌ 타이머 리셋 후 Airtable 업데이트 실패: ${room}`, error);
                }
            } else {
                console.log(`⚠️ ${room}의 recordId를 찾을 수 없음`);
            }
        }
        
        roomTimers[room] = {
            isRunning: false,
            timeLeft: 0,
            startTime: 0,
            wasRunning: false,
            label: '',
            isCountUp: false
        };
        io.emit('timerState', { room, state: roomTimers[room] });
    });

    socket.on('adjustTimer', async ({ room, diff }) => {
        if (!roomTimers[room]) return;
        // 0초 미만으로 내려가지 않게
        roomTimers[room].timeLeft = Math.max(0, roomTimers[room].timeLeft + diff);
        
        // Airtable 수납 테이블 업데이트 (남은 시간)
        if (roomNames[room] && roomNames[room].trim() && roomTimers[room].isRunning) {
            const recordId = roomRecordIds[room];
            if (recordId) {
                try {
                    const label = roomTimers[room].label || '치료';
                    
                    // 카운트업 모드와 일반 모드 구분하여 메시지 생성
                    let treatmentInfo = '';
                    if (roomTimers[room].isCountUp) {
                        // 카운트업 모드: 경과 시간 표시
                        const elapsedMinutes = Math.floor(roomTimers[room].timeLeft / 60);
                        treatmentInfo = `${label} (${elapsedMinutes}분경과)`;
                    } else {
                        // 일반 모드: 남은 시간 표시
                        const remainingMinutes = Math.ceil(roomTimers[room].timeLeft / 60);
                        treatmentInfo = `${label} ${remainingMinutes}분 남음`;
                    }
                    
                    await updateAirtablePayment(recordId, treatmentInfo, false); // 진행 중인 치료
                    console.log(`✅ 타이머 조정 후 Airtable 업데이트 성공: ${room} - ${treatmentInfo}`);
                } catch (error) {
                    console.error(`❌ 타이머 조정 후 Airtable 업데이트 실패: ${room}`, error);
                }
            } else {
                console.log(`⚠️ ${room}의 recordId를 찾을 수 없음`);
            }
        }
        
        io.emit('timerState', { room, state: roomTimers[room] });
    });

    socket.on('stopTimer', ({ room }) => {
        if (!roomTimers[room]) return;
        if (!roomTimers[room].isRunning) return;
        roomTimers[room].isRunning = false;
        io.emit('timerState', { room, state: roomTimers[room] });
    });

    socket.on('doneAlarm', async ({ room }) => {
        if (!roomTimers[room]) return;
        const currentLabel = (roomTimers[room].label || '').trim();
        
        // 완료 시간을 먼저 기록하고 즉시 클라이언트에 전송
        const now = new Date();
        const completionTimestamp = now.getTime();
        const endTimeForAirtable = now.toISOString();

        const patientKeyForOrder = getPatientKeyForRoom(room);
        const statusKeyForCompletion = TIMER_LABEL_TO_STATUS_KEY[currentLabel];
        if (patientKeyForOrder && statusKeyForCompletion) {
            recordTreatmentCompletion(room, patientKeyForOrder, statusKeyForCompletion, completionTimestamp);
        }
        
        // 즉시 클라이언트에 완료 이벤트 전송 (Airtable 업데이트 전에)
        io.emit('doneAlarm', { room, label: currentLabel, finishedAt: endTimeForAirtable });
        
        const completionBehaviors = {
            '침': {
                checkbox: '침종료',
                extraPayload: {},
                nextState: { label: '대기중', isCountUp: true, isRunning: true }
            },
            '부항': {
                checkbox: '부항종료',
                extraPayload: {},
                nextState: { label: '대기중', isCountUp: true, isRunning: true }
            },
            '뜸': {
                checkbox: '뜸종료',
                extraPayload: {},
                nextState: { label: '대기중', isCountUp: true, isRunning: true }
            },
            '진료중': {
                checkbox: '원끝',
                extraPayload: { '원상': '완료' },
                nextState: { label: '대기중', isCountUp: true, isRunning: true }
            },
            '상담중': {
                checkbox: '심끝',
                extraPayload: { '심상': '완료' },
                nextState: { label: '대기중', isCountUp: true, isRunning: true }
            },
            '검사중': {
                checkbox: '검끝',
                extraPayload: { '검시': true },
                nextState: { label: '대기중', isCountUp: true, isRunning: true }
            },
            '안내중': {
                checkbox: '안끝',
                extraPayload: { '안시': true },
                nextState: { label: '대기중', isCountUp: true, isRunning: true }
            }
        };
        const behavior = completionBehaviors[currentLabel];
        
        if (roomNames[room] && roomNames[room].trim()) {
            const recordId = roomRecordIds[room];
            if (recordId) {
                try {
                    if (behavior && behavior.checkbox) {
                        try {
                            await new Promise((resolve, reject) => {
                                const payload = {};
                                payload[behavior.checkbox] = true;
                                if (behavior.extraPayload) {
                                    Object.assign(payload, behavior.extraPayload);
                                }
                                base(AIRTABLE_TABLE_NAME).update(recordId, payload, (err, record) => {
                                    if (err) {
                                        console.error(`❌ ${behavior.checkbox} 체크박스 업데이트 실패:`, err);
                                        reject(err);
                                    } else {
                                        console.log(`✅ ${behavior.checkbox} 체크박스 true로 업데이트 완료`);
                                        resolve(record);
                                    }
                                });
                            });
                        } catch (error) {
                            console.error(`❌ ${behavior.checkbox} 체크박스 업데이트 실패:`, error);
                        }
                    }

                    // endTimeForAirtable은 이미 위에서 생성됨
                    await updateAirtablePayment(recordId, '', true);
                    console.log(`✅ 발침완료 후 Airtable 비고(순서) 필드 비움: ${room}`);

                    // 치료 종료 시간 기록
                    const treatmentLabel = roomTimers[room].label || '';
                    let endTimeField = '';
                    if (treatmentLabel === '침') {
                        endTimeField = '침끝';
                    } else if (treatmentLabel === '부항') {
                        endTimeField = '부항끝';
                    } else if (treatmentLabel === '뜸') {
                        endTimeField = '뜸끝';
                    } else if (treatmentLabel === '진료중') {
                        endTimeField = '원진종료';
                    } else if (treatmentLabel === '상담중') {
                        endTimeField = '심상종료';
                    } else if (treatmentLabel === '검사중') {
                        endTimeField = '검사끝';
                    } else if (treatmentLabel === '안내중') {
                        endTimeField = '안내끝';
                    }
                    
                    if (endTimeField) {
                        try {
                            await updateTreatmentTime(recordId, endTimeField, endTimeForAirtable);
                            console.log(`✅ ${endTimeField} 시간 기록 성공: ${endTimeForAirtable}`);
                        } catch (error) {
                            console.error(`❌ ${endTimeField} 시간 기록 실패:`, error);
                        }
                    }

                    const nextState = behavior?.nextState || { label: '', isCountUp: false, isRunning: false };
                    if (nextState.label === '대기중') {
                        try {
                            await updateNewLabelStatus(recordId, '대기중');
                        } catch (error) {
                            console.error(`❌ 대기중 라벨 업데이트 실패: ${room}`, error);
                        }
                    }

                    if (nextState.isRunning) {
                        roomTimers[room] = {
                            ...roomTimers[room],
                            isRunning: true,
                            duration: 0,
                            timeLeft: 0,
                            startTime: Date.now(),
                            wasRunning: false,
                            label: nextState.label || '',
                            isCountUp: !!nextState.isCountUp
                        };
                    } else {
                        roomTimers[room] = {
                            ...roomTimers[room],
                            isRunning: false,
                            duration: 0,
                            timeLeft: 0,
                            startTime: 0,
                            wasRunning: false,
                            label: nextState.label || '',
                            isCountUp: !!nextState.isCountUp
                        };
                    }
                    stateUpdated = true;

                } catch (error) {
                    console.error(`❌ 발침완료 후 Airtable 업데이트 실패: ${room}`, error);
                }
            } else {
                console.log(`⚠️ ${room}의 recordId를 찾을 수 없음`);
            }
        }
        if (!stateUpdated) {
            roomTimers[room] = {
                ...roomTimers[room],
                isRunning: false,
                duration: 0,
                timeLeft: 0,
                startTime: 0,
                wasRunning: false,
                label: '',
                isCountUp: false
            };
        }
        io.emit('timerState', { room, state: { ...roomTimers[room] } });
        // doneAlarm은 이미 위에서 전송했으므로 여기서는 중복 전송하지 않음
    });

    socket.on('updateName', ({ room, name }) => {
        roomNames[room] = name;
        io.emit('nameUpdate', { room, name });
    });

    socket.on('updateLabel', async ({ room, label }) => {
        if (roomTimers[room]) {
            roomTimers[room].label = label;
            
            // 카운트업 모드 여부 업데이트
            const isCountUp = ['진료중', '상담중', '대기중', '검사중', '안내중'].includes(label);
            roomTimers[room].isCountUp = isCountUp;
            
            io.emit('timerState', { room, state: { ...roomTimers[room] } });
            
            // 라벨 변경 시 즉시 Airtable 업데이트
            if (roomNames[room] && roomNames[room].trim() && roomTimers[room].isRunning) {
                const recordId = roomRecordIds[room];
                if (recordId) {
                    try {
                        // 카운트업 모드와 일반 모드 구분하여 메시지 생성
                        let treatmentInfo = '';
                        if (isCountUp) {
                            treatmentInfo = `${label || '상태'}`;
                        } else {
                            // 남은 시간을 분으로 계산
                            const remainingMinutes = Math.ceil(roomTimers[room].timeLeft / 60);
                            treatmentInfo = `${label || '치료'} ${remainingMinutes}분 남음`;
                        }
                        
                        await updateAirtablePayment(recordId, treatmentInfo, false); // 진행 중인 치료
                        console.log(`✅ 라벨 변경 후 Airtable 업데이트 성공: ${room} - ${treatmentInfo}`);
                    } catch (error) {
                        console.error(`❌ 라벨 변경 후 Airtable 업데이트 실패: ${room}`, error);
                    }
                }
            }
        }
    });

    // 침 갯수 업데이트
    socket.on('updateNeedleCount', async ({ room, needleCount }) => {
        console.log('========================================');
        console.log(`💉 침 갯수 업데이트 요청 받음!`);
        console.log(`   방: ${room}`);
        console.log(`   침 갯수: ${needleCount}개`);
        console.log('========================================');
        
        const recordId = roomRecordIds[room];
        if (recordId) {
            try {
                await new Promise((resolve, reject) => {
                    base(AIRTABLE_TABLE_NAME).update(recordId, {
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
                
                // 저장 성공 응답 전송
                socket.emit('needleCountSaved', { room, needleCount, success: true });
                
            } catch (error) {
                console.error(`❌ 침 갯수 업데이트 실패: ${room}`, error);
                // 저장 실패 응답 전송
                socket.emit('needleCountSaved', { room, needleCount, success: false });
            }
        } else {
            console.log(`⚠️ ${room}의 recordId를 찾을 수 없어 침 갯수를 저장할 수 없습니다`);
            // 저장 실패 응답 전송
            socket.emit('needleCountSaved', { room, needleCount, success: false });
        }
    });

    socket.on('endTreatment', async ({ room }) => {
        console.log(`🏥 진료끝 요청 받음: ${room}`);
        
        // 타이머 리셋
        if (roomTimers[room]) {
            roomTimers[room] = {
                isRunning: false,
                timeLeft: 0,
                startTime: 0,
                wasRunning: false,
                label: '',
                isCountUp: false
            };
            io.emit('timerState', { room, state: roomTimers[room] });
            console.log(`✅ 진료끝 시 타이머 리셋 완료: ${room}`);
        }
        
        if (roomNames[room] && roomNames[room].trim()) {
            const recordId = roomRecordIds[room];
            if (recordId) {
                try {
                    // Airtable에서 해당 레코드를 가져와서 "진끝" 필드를 true로 설정
                    const airtable = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
                    
                    await airtable('수납').update(recordId, {
                        '진끝': true
                    });
                    
                    console.log(`✅ 진료끝 처리 완료: ${room} - 진끝 체크박스 설정`);
                    
                    // 비고(순서) 필드 비우기
                    await updateAirtablePayment(recordId, '', false);
                    console.log(`✅ 진료끝 시 Airtable 비고(순서) 필드 비움: ${room}`);
                    
                    // 방 점유 상태 업데이트
                    roomNames[room] = '';
                    roomOccupied[room] = false;
                    resetTreatmentOrderCache(room);
                    
                    // 클라이언트에 업데이트된 상태 전송
                    io.emit('namesRefreshed', { names: roomNames, occupied: roomOccupied });
                    
                } catch (error) {
                    console.error(`❌ 진료끝 처리 실패: ${room}`, error);
                }
            } else {
                console.log(`⚠️ ${room}의 recordId를 찾을 수 없음`);
            }
        } else {
            console.log(`⚠️ ${room}에 환자 정보가 없음`);
        }
    });

    socket.on('refreshNames', async () => {
        console.log('🔄 이름 새로고침 요청 받음');
        // Airtable에서 최신 이름 데이터를 가져오는 함수 호출
        try {
            const data = await fetchNamesFromAirtable();
            console.log('📊 Airtable에서 가져온 이름:', data);
            // names 객체에서 이름 데이터 추출
            const names = data.names || data;
            
            // 기존 서버에서 이미 필터링된 데이터로 완전히 교체
            // 모든 방의 이름을 먼저 초기화
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
            
            // 클라이언트에 이름과 점유 상태 전송
            console.log('📤 클라이언트에 전송할 데이터:', { names: roomNames, occupied: roomOccupied });
            socket.emit('namesRefreshed', { names: roomNames, occupied: roomOccupied });
            
            // Airtable 체크박스 상태에 따른 라벨 업데이트 (즉시 실행)
            console.log('🔍 체크박스 상태 즉시 확인 중...');
            for (const room of ROOM_NAMES) {
                if (roomRecordIds[room]) {
                    await updateLabelFromAirtableCheckboxes(roomRecordIds[room], room);
                }
            }
        } catch (err) {
            console.error('❌ Airtable에서 이름 가져오기 실패:', err);
            // 실패 시 현재 저장된 이름이라도 보내기
            console.log('📤 실패 시 전송할 데이터:', roomNames);
            socket.emit('namesRefreshed', { names: roomNames, occupied: roomOccupied });
        }
    });

    socket.on('disconnect', () => {
        console.log('사용자 연결 해제');
    });
});

// 타이머 업데이트 및 슬랙 알림
setInterval(() => {
    ROOM_NAMES.forEach(async (room) => {
        const timer = roomTimers[room];
        if (!timer.isRunning) return;
        
        // 카운트업 모드와 일반 모드 구분
        if (timer.isCountUp) {
            // 카운트업 모드: 경과 시간 증가
            timer.timeLeft += 1;
            // 검사중/진료중/상담중/대기중일 때 비고(순서) 업데이트
            if (['진료중', '상담중', '대기중', '검사중', '안내중'].includes(timer.label)) {
                const elapsedMinutes = Math.floor(timer.timeLeft / 60);
                const statusWithTime = `${timer.label} (${elapsedMinutes}분경과)`;
                if (roomNames[room] && roomNames[room].trim()) {
                    const recordId = roomRecordIds[room];
                    if (recordId) {
                        try {
                            await updateAirtablePayment(recordId, statusWithTime, false);
                        } catch (e) {
                            console.error(`❌ 카운트업 비고(순서) 업데이트 실패: ${room}`, e);
                        }
                    }
                }
            }
        } else {
            // 일반 모드: 남은 시간 감소
            timer.timeLeft = Math.max(0, timer.timeLeft - 1);
        }

        io.emit('timerState', { room, state: { ...timer } });

        // 일반 모드에서만 타이머 종료 처리 (카운트업 모드는 무한히 계속됨)
        if (!timer.isCountUp && timer.timeLeft === 0 && !timer.wasRunning) {
            timer.isRunning  = false;
            timer.wasRunning = true;
            io.emit('timerState', { room, state: { ...timer } });
            
            // 타이머 종료 시 클라이언트에 알림 이벤트 전송 (발침완료 버튼 표시용)
            io.emit('timerEnded', { room });

            // 타이머 자동 종료 시 "발침(발뜸, 발부) 요망!!" 표시
            if (roomNames[room] && roomNames[room].trim()) {
                const recordId = roomRecordIds[room];
                if (recordId) {
                    try {
                        const label = timer.label || '치료';
                        let alarmMessage = '';
                        if (label === '침') {
                            alarmMessage = '발침 요망!!';
                        } else if (label === '뜸') {
                            alarmMessage = '발뜸 요망!!';
                        } else if (label === '부항') {
                            alarmMessage = '발부 요망!!';
                        } else {
                            alarmMessage = '발침 요망!!';
                        }
                        await updateAirtablePayment(recordId, alarmMessage, false);
                        console.log(`✅ 타이머 자동 종료 후 Airtable 알림 메시지 업데이트: ${room} - ${alarmMessage}`);
                    } catch (error) {
                        console.error(`❌ 타이머 자동 종료 후 Airtable 업데이트 실패: ${room}`, error);
                    }
                }
            }

            // 슬랙 알림 (침, 뜸, 부항 라벨일 때 또는 아무 라벨이 없을 때, 단 진료중/상담중/대기중은 제외)
            if ((!timer.label || timer.label.trim() === '' || ['침', '뜸', '부항'].includes(timer.label.trim())) && 
                !['진료중', '상담중', '대기중', '검사중', '안내중'].includes(timer.label)) {
                let text = `[${room}] 타이머가 종료되었습니다!`;
                const name = roomNames[room];
                if (name && name.trim()) {
                    text += ` (이름: ${name.trim()})`;
                }
                if (timer.label && timer.label.trim()) {
                    const minutes = Math.floor(timer.duration / 60);
                    text += ` (${timer.label.trim()} ${minutes}분)`;
                }
                axios.post(SLACK_WEBHOOK_URL, {
                    text
                })
                    .then(res => {
                        if (res.status === 200) {
                            console.log(`[Slack] 알림 전송 성공: ${text}`);
                        } else {
                            console.error('[Slack] 알림 전송 실패:', res.data);
                        }
                    })
                    .catch(err => console.error('[Slack] 알림 전송 실패:', err?.response?.data || err.message));
            }

        }
    });
}, 1000);

// 1분마다 방 점유 상태 확인 폴링 (필요한 기능)
setInterval(async () => {
    try {
        console.log('🔄 1분 폴링 - 방 점유 상태 확인 중...');
        const data = await fetchNamesFromAirtable();
        console.log('📊 1분 폴링 - Airtable에서 가져온 이름:', data);
        
        // names 객체에서 이름 데이터 추출
        const names = data.names || data;
        
        // 모든 방의 이름을 먼저 초기화
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
        
        // 클라이언트에 이름과 점유 상태 전송
        io.emit('namesRefreshed', { names: roomNames, occupied: roomOccupied });
        console.log('📤 1분 폴링 - 방 점유 상태 업데이트 전송 완료');
        
        // 환자가 있는 방만 타이머 상태 Airtable 업데이트
        for (const room of ROOM_NAMES) {
            const timer = roomTimers[room];
            const recordId = roomRecordIds[room];
            
            // 환자가 있는 방만 처리
            if (roomNames[room] && roomNames[room].trim() && recordId) {
                console.log(`🔍 1분 폴링 - ${room} (${roomNames[room]}): timer=${!!timer}, isRunning=${timer?.isRunning}, label=${timer?.label}`);

                try {
                    const record = await getAirtableRecord(recordId);
                    const fields = record?.fields || {};
                    console.log(`🧾 1분 폴링 - ${room} Airtable 필드 확인:`, {
                        '원시': fields['원시'],
                        '원끝': fields['원끝'],
                        '원상': fields['원상'],
                        '침': fields['침'],
                        '침종료': fields['침종료'],
                        '부항': fields['부항'],
                        '부항종료': fields['부항종료'],
                        '뜸': fields['뜸'],
                        '뜸종료': fields['뜸종료'],
                        '검시': fields['검시'],
                        '검끝': fields['검끝'],
                        '안시': fields['안시'],
                        '안끝': fields['안끝'],
                        '심시': fields['심시'],
                        '심끝': fields['심끝'],
                        '심상': fields['심상']
                    });
                } catch (fieldErr) {
                    console.error(`❌ 1분 폴링 - ${room} Airtable 필드 조회 실패:`, fieldErr);
                }
                
                if (timer && timer.isRunning && timer.label) {
                    try {
                        const label = timer.label.trim();
                    
                        // 모든 타이머 상태 Airtable 업데이트
                        if (['진료중', '상담중', '대기중', '검사중', '안내중'].includes(label)) {
                            // 카운트업 모드: 경과시간 표시
                            console.log(`📝 1분 폴링 - ${room} ${label} 상태 Airtable 업데이트`);
                            
                            // 경과시간 계산 (분 단위)
                            const elapsedMinutes = Math.floor(timer.timeLeft / 60);
                            const elapsedSeconds = timer.timeLeft % 60;
                            const elapsedTimeStr = `${String(elapsedMinutes).padStart(2, '0')}:${String(elapsedSeconds).padStart(2, '0')}`;
                            
                            // 비고(순서) 필드에 상태와 경과시간 업데이트
                            const statusWithTime = `${label} (${elapsedMinutes}분경과)`;
                            await updateAirtablePayment(recordId, statusWithTime, false);
                        } else if (['침', '뜸', '부항'].includes(label)) {
                            // 일반 타이머: 남은 시간 표시
                            const remainingMinutes = Math.ceil(timer.timeLeft / 60);
                            const remainingSeconds = timer.timeLeft % 60;
                            console.log(`📝 1분 폴링 - ${room} ${label} 타이머 Airtable 업데이트: ${remainingMinutes}분 ${remainingSeconds}초 남음 (timeLeft: ${timer.timeLeft})`);
                            
                            // 비고(순서) 필드에 상태와 남은 시간 업데이트
                            const statusWithTime = `${label} ${remainingMinutes}분 남음`;
                            await updateAirtablePayment(recordId, statusWithTime, false);
                        }
                        
                        // 체크박스 업데이트 (카운트업 모드일 때만)
                        if (['진료중', '상담중', '대기중', '검사중', '안내중'].includes(label)) {
                            const updateData = {};
                            if (label === '진료중') {
                                updateData['원시'] = true;  // 원시 체크박스 true
                                updateData['원끝'] = false; // 원끝 체크박스 false
                            } else if (label === '상담중') {
                                updateData['심시'] = true;  // 심시 체크박스 true
                                updateData['심끝'] = false; // 심끝 체크박스 false
                            }
                            
                            if (Object.keys(updateData).length > 0) {
                                await new Promise((resolve, reject) => {
                                    base(AIRTABLE_TABLE_NAME).update(recordId, updateData, (err, record) => {
                                        if (err) {
                                            console.error(`❌ 1분 폴링 - ${label} 체크박스 업데이트 실패:`, err);
                                            reject(err);
                                        } else {
                                            console.log(`✅ 1분 폴링 - ${label} 체크박스 업데이트 완료:`, record.fields);
                                            resolve(record);
                                        }
                                    });
                                });
                            }
                        }
                        // 1분 폴링 - 안내중 체크박스 업데이트
                        if (label === '안내중') {
                            const updateData = { '안시': true, '안끝': false };
                            await new Promise((resolve, reject) => {
                                base(AIRTABLE_TABLE_NAME).update(recordId, updateData, (err, record) => {
                                    if (err) {
                                        console.error(`❌ 1분 폴링 - 안내중 체크박스 업데이트 실패:`, err);
                                        reject(err);
                                    } else {
                                        console.log(`✅ 1분 폴링 - 안내중 체크박스 업데이트 완료:`, record.fields);
                                        resolve(record);
                                    }
                                });
                            });
                        }
                    } catch (error) {
                        console.error(`❌ 1분 폴링 - ${room} Airtable 업데이트 실패:`, error);
                    }
                }
            }
        }
    } catch (error) {
        console.error('❌ 1분 폴링 중 방 점유 상태 확인 실패:', error);
    }
}, 60000); // 1분(60000ms)마다 실행

// Airtable 웹훅 엔드포인트 - 이벤트 타입별 처리
app.post('/airtable-webhook', async (req, res) => {
    try {
        console.log('🔔 Airtable 웹훅 수신:', req.body);
        
        const { eventType, recordId, 방, 이름, ...fields } = req.body;
        
        if (!recordId) {
            console.log('⚠️ recordId가 없음');
            return res.status(400).json({ error: 'Missing recordId' });
        }
        
        console.log(`🎯 이벤트 타입: ${eventType}, 방: ${방}, 이름: ${이름}`);
        
        // 이벤트 타입별 처리
        switch (eventType) {
            case 'room_enter':
                // 환자 입장 처리
                if (방 && 이름) {
                    roomNames[방] = 이름.trim();
                    roomOccupied[방] = true;
                    resetTreatmentOrderCache(방);
                    
                    console.log(`👤 환자 입장: ${방} - ${이름.trim()}`);
                    
                    // 클라이언트에 실시간 업데이트 전송
                    io.emit('namesRefreshed', { names: roomNames, occupied: roomOccupied });
                    io.emit('nameUpdate', { room: 방, name: 이름.trim(), recordId });
                    
                    console.log(`📤 환자 입장 정보 전송 완료: ${방} - ${이름.trim()}`);
                }
                break;
                
            case 'room_exit':
                // 환자 퇴장 처리 (진끝 체크)
                if (방) {
                    roomNames[방] = '';
                    roomOccupied[방] = false;
                    resetTreatmentOrderCache(방);
                    
                    console.log(`🏠 환자 퇴장: ${방}`);
                    
                    // 클라이언트에 실시간 업데이트 전송
                    io.emit('namesRefreshed', { names: roomNames, occupied: roomOccupied });
                    
                    console.log(`📤 환자 퇴장 정보 전송 완료: ${방}`);
                }
                break;
                
            case 'status_update':
                // 체크박스 상태 변경 처리
                const room = Object.keys(roomRecordIds).find(roomName => roomRecordIds[roomName] === recordId);
                
                if (room) {
                    console.log(`🔍 상태 변경 - 방: ${room}, recordId: ${recordId}`);
                    console.log(`📊 변경된 필드들:`, fields);
                    
                    // 체크박스 변경에 따른 라벨 업데이트
                    await updateLabelFromAirtableCheckboxes(recordId, room);
                    
                    // 진끝 상태 변경 시 방 점유 상태 업데이트
                    if (fields.진끝 !== undefined) {
                        const isOccupied = !fields.진끝;
                        roomOccupied[room] = isOccupied;
                        
                        if (fields.진끝) {
                            roomNames[room] = '';
                            resetTreatmentOrderCache(room);
                            console.log(`🏠 방 비움: ${room} (진끝 체크됨)`);
                        }
                        
                        io.emit('namesRefreshed', { names: roomNames, occupied: roomOccupied });
                        console.log(`📤 방 점유 상태 업데이트 전송: ${room} - ${isOccupied ? '점유 중' : '빈 방'}`);
                    }
                }
                break;
                
            default:
                console.log(`⚠️ 알 수 없는 이벤트 타입: ${eventType}`);
                return res.status(400).json({ error: 'Unknown event type' });
        }
        
        res.status(200).json({ success: true, eventType, room: 방, recordId });
        
    } catch (error) {
        console.error('❌ Airtable 웹훅 처리 실패:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`🌐 Airtable 웹훅 URL: http://your-server-ip:${PORT}/airtable-webhook`);
});
