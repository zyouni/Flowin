from flask import Flask, request, jsonify

app = Flask(__name__)

# ✅ 루트 경로 먼저 정의
@app.route('/')
def index():
    return '✅ Flask is running and reachable!'

@app.route('/airtable-webhook', methods=['POST'])
def airtable_webhook():
    data = request.json
    print("📦 Airtable webhook received:", data)
    return jsonify({"status": "ok"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)
