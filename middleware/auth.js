// 인증 미들웨어
function requireAuth(req, res, next) {
    if (req.session && req.session.hospitalId) {
        return next();
    }
    // 로그인 페이지로 리다이렉트
    res.redirect('/login.html');
}

module.exports = { requireAuth };

