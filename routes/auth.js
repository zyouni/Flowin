const express = require('express');
const router = express.Router();
const { verifyLogin } = require('../services/googleSheets');

// 로그인 페이지
router.get('/login.html', (req, res) => {
    // 이미 로그인되어 있으면 메인 페이지로 리다이렉트
    if (req.session && req.session.hospitalId) {
        return res.redirect('/');
    }
    res.sendFile(__dirname + '/../public/login.html');
});

// 로그인 처리
router.post('/api/login', async (req, res) => {
    try {
        const { hospitalId, password, loginId } = req.body;
        
        // hospitalId 또는 loginId 둘 다 지원
        const inputLoginId = loginId || hospitalId;
        
        if (!inputLoginId || !password) {
            return res.status(400).json({ error: '로그인 ID와 비밀번호를 입력해주세요.' });
        }
        
        const hospitalInfo = await verifyLogin(inputLoginId, password);
        
        if (hospitalInfo) {
            // 로그인 성공 - 세션에 저장
            req.session.hospitalId = hospitalInfo.loginId || hospitalInfo.clinicId || inputLoginId;
            req.session.hospitalInfo = hospitalInfo;
            req.session.dataSheetId = hospitalInfo.dataSheetId || hospitalInfo.data_sheet_id || '';
            console.log(`✅ 로그인 성공: ${req.session.hospitalId}, dataSheetId: ${req.session.dataSheetId}`);
            return res.json({ 
                success: true, 
                hospitalId: req.session.hospitalId,
                clinicName: hospitalInfo.clinicName || hospitalInfo.clinicname || '',
                dataSheetId: req.session.dataSheetId
            });
        } else {
            // 로그인 실패
            console.log(`❌ 로그인 실패: ${inputLoginId}`);
            return res.status(401).json({ error: '로그인 ID 또는 비밀번호가 올바르지 않습니다.' });
        }
    } catch (error) {
        console.error('❌ 로그인 처리 중 오류:', error);
        return res.status(500).json({ error: '로그인 처리 중 오류가 발생했습니다: ' + error.message });
    }
});

// 로그아웃 처리 (POST)
router.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('❌ 세션 삭제 실패:', err);
            return res.status(500).json({ error: '로그아웃 처리 중 오류가 발생했습니다.' });
        }
        res.json({ success: true });
    });
});

// 로그아웃 처리 (GET)
router.get('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('❌ 세션 삭제 실패:', err);
            return res.status(500).json({ error: '로그아웃 처리 중 오류가 발생했습니다.' });
        }
        res.redirect('/login.html');
    });
});

module.exports = router;

