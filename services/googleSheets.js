const { google } = require('googleapis');

// Google Sheets 설정
const GOOGLE_SHEETS_SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : null;

// Google Sheets API 클라이언트 초기화
let sheetsClient = null;
if (GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_PRIVATE_KEY && GOOGLE_SHEETS_SPREADSHEET_ID) {
    try {
        const auth = new google.auth.JWT(
            GOOGLE_SERVICE_ACCOUNT_EMAIL,
            null,
            GOOGLE_PRIVATE_KEY,
            ['https://www.googleapis.com/auth/spreadsheets'] // read/write 권한
        );
        sheetsClient = google.sheets({ version: 'v4', auth });
        console.log('✅ Google Sheets API 클라이언트 초기화 완료 (read/write)');
    } catch (error) {
        console.error('❌ Google Sheets API 초기화 실패:', error.message);
    }
} else {
    console.warn('⚠️ Google Sheets 환경변수가 설정되지 않았습니다. 로그인 기능이 작동하지 않을 수 있습니다.');
}

// Google Sheets에서 로그인 정보 조회
async function verifyLogin(loginId, password) {
    if (!sheetsClient || !GOOGLE_SHEETS_SPREADSHEET_ID) {
        throw new Error('Google Sheets 설정이 완료되지 않았습니다.');
    }
    
    try {
        // 스프레드시트에서 데이터 읽기 (첫 번째 시트)
        const response = await sheetsClient.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
            range: 'A:Z', // 전체 시트 읽기
        });
        
        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            console.log('⚠️ 스프레드시트에 데이터가 없습니다.');
            return null;
        }
        
        // 첫 번째 행은 헤더로 간주
        const headers = rows[0].map(h => (h || '').trim());
        const headersLower = headers.map(h => h.toLowerCase());
        
        // loginId 컬럼 찾기
        const loginIdIndex = headersLower.findIndex(h => 
            h === 'loginid' || h === 'login_id' || 
            (h.includes('login') && h.includes('id')) ||
            h === '아이디' || h === 'id' || h === 'hospitalid'
        );
        
        // password 컬럼 찾기
        const passwordIndex = headersLower.findIndex(h => 
            h === 'password' || h === 'pw' || h === '비밀번호'
        );
        
        // data_sheet_id 컬럼 찾기
        const dataSheetIdIndex = headersLower.findIndex(h => 
            h === 'data_sheet_id' || h === 'datasheetid' || h === 'datasheet_id' || (h.includes('sheet') && h.includes('id'))
        );
        
        if (loginIdIndex === -1 || passwordIndex === -1) {
            console.error('❌ 스프레드시트에 필요한 컬럼을 찾을 수 없습니다.');
            console.log('찾은 헤더:', headers);
            console.log('loginIdIndex:', loginIdIndex, 'passwordIndex:', passwordIndex);
            return null;
        }
        
        console.log(`✅ 컬럼 찾기 성공: loginId=${headers[loginIdIndex]}, password=${headers[passwordIndex]}`);
        
        // 데이터 행에서 일치하는 로그인 정보 찾기
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            // 빈 행은 건너뛰기
            if (!row || row.length === 0) continue;
            
            const rowLoginId = (row[loginIdIndex] || '').toString().trim();
            const rowPassword = (row[passwordIndex] || '').toString().trim();
            
            // 빈 값은 건너뛰기
            if (!rowLoginId || !rowPassword) continue;
            
            console.log(`🔍 확인 중: 입력된 loginId="${loginId}", 스프레드시트 loginId="${rowLoginId}"`);
            
            if (rowLoginId === loginId && rowPassword === password) {
                // 로그인 성공 - 병원 정보 반환
                const hospitalInfo = {
                    loginId: rowLoginId,
                    // 모든 헤더 정보를 포함
                };
                
                // 헤더에 다른 정보가 있다면 포함
                headers.forEach((header, index) => {
                    if (row[index] !== undefined && row[index] !== null && row[index] !== '') {
                        hospitalInfo[header] = row[index].toString().trim();
                    }
                });
                
                // data_sheet_id가 있으면 별도로 저장
                if (dataSheetIdIndex !== -1 && row[dataSheetIdIndex]) {
                    hospitalInfo.dataSheetId = row[dataSheetIdIndex].toString().trim();
                }
                
                console.log(`✅ 로그인 성공:`, hospitalInfo);
                return hospitalInfo;
            }
        }
        
        console.log(`❌ 일치하는 로그인 정보를 찾을 수 없습니다.`);
        return null; // 일치하는 정보 없음
    } catch (error) {
        console.error('❌ Google Sheets 조회 실패:', error);
        throw error;
    }
}

// Google Sheets에서 환자 목록 가져오기 (patients 시트)
async function fetchPatientsFromGoogleSheets(dataSheetId, roomNames = []) {
    if (!sheetsClient || !dataSheetId) {
        console.log('⚠️ Google Sheets 클라이언트 또는 dataSheetId가 없습니다.');
        return { names: {}, occupied: {} };
    }
    
    try {
        console.log(`📊 Google Sheets에서 환자 목록 조회: ${dataSheetId}`);
        
        // patients 시트에서 데이터 읽기
        const response = await sheetsClient.spreadsheets.values.get({
            spreadsheetId: dataSheetId,
            range: 'patients!A:Z',
        });
        
        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            console.log('⚠️ patients 시트에 데이터가 없습니다.');
            return { names: {}, occupied: {} };
        }
        
        // 첫 번째 행은 헤더
        const headers = rows[0].map(h => (h || '').trim());
        const headersLower = headers.map(h => h.toLowerCase());
        
        // 컬럼 인덱스 찾기
        const nameIndex = headersLower.findIndex(h => 
            h === '이름' || h === 'name' || h.includes('name')
        );
        const bedIndex = headersLower.findIndex(h => 
            h === 'bed' || h === '침대' || h === '방' || h.includes('room')
        );
        const chartIndex = headersLower.findIndex(h => 
            h === '차트번호' || h === 'chart' || h.includes('chart')
        );
        
        if (nameIndex === -1) {
            console.error('❌ patients 시트에 이름 컬럼을 찾을 수 없습니다.');
            return { names: {}, occupied: {} };
        }
        
        // 방별 환자 이름 매핑
        const names = {};
        const occupied = {};
        
        // 데이터 행 처리
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;
            
            const patientName = (row[nameIndex] || '').toString().trim();
            if (!patientName) continue;
            
            // bed/방 정보가 있으면 해당 방에 할당, 없으면 빈 방에 할당
            let roomName = null;
            if (bedIndex !== -1 && row[bedIndex]) {
                const bedValue = (row[bedIndex] || '').toString().trim();
                // bed 값이 방 이름과 일치하는지 확인
                if (roomNames.includes(bedValue)) {
                    roomName = bedValue;
                }
            }
            
            // 방이 지정되지 않았으면 빈 방 찾기
            if (!roomName) {
                for (const room of roomNames) {
                    if (!names[room]) {
                        roomName = room;
                        break;
                    }
                }
            }
            
            if (roomName) {
                names[roomName] = patientName;
                occupied[roomName] = true;
            }
        }
        
        console.log(`✅ 환자 목록 조회 완료:`, names);
        return { names, occupied };
        
    } catch (error) {
        console.error('❌ Google Sheets에서 환자 목록 조회 실패:', error);
        return { names: {}, occupied: {} };
    }
}

// Google Sheets에 내원 기록 추가 (history 시트)
async function addVisitRecord(dataSheetId, visitData) {
    if (!sheetsClient || !dataSheetId) {
        console.log('⚠️ Google Sheets 클라이언트 또는 dataSheetId가 없습니다.');
        return null;
    }
    
    try {
        console.log(`📝 Google Sheets에 내원 기록 추가: ${dataSheetId}`);
        
        // history 시트에 데이터 추가
        const response = await sheetsClient.spreadsheets.values.append({
            spreadsheetId: dataSheetId,
            range: 'history!A:Z',
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: [visitData]
            }
        });
        
        console.log(`✅ 내원 기록 추가 완료`);
        return response.data;
        
    } catch (error) {
        console.error('❌ Google Sheets에 내원 기록 추가 실패:', error);
        throw error;
    }
}

// Google Sheets에서 내원 기록 업데이트
async function updateVisitRecord(dataSheetId, rowIndex, updateData) {
    if (!sheetsClient || !dataSheetId) {
        console.log('⚠️ Google Sheets 클라이언트 또는 dataSheetId가 없습니다.');
        return null;
    }
    
    try {
        console.log(`📝 Google Sheets 내원 기록 업데이트: ${dataSheetId}, row: ${rowIndex}`);
        
        // history 시트에서 해당 행 업데이트
        const response = await sheetsClient.spreadsheets.values.update({
            spreadsheetId: dataSheetId,
            range: `history!A${rowIndex}:Z${rowIndex}`,
            valueInputOption: 'RAW',
            resource: {
                values: [updateData]
            }
        });
        
        console.log(`✅ 내원 기록 업데이트 완료`);
        return response.data;
        
    } catch (error) {
        console.error('❌ Google Sheets 내원 기록 업데이트 실패:', error);
        throw error;
    }
}

module.exports = {
    sheetsClient,
    verifyLogin,
    fetchPatientsFromGoogleSheets,
    addVisitRecord,
    updateVisitRecord
};

