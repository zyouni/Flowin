import json
import socketio
import paho.mqtt.client as mqtt
import time
import logging

MQTT_BROKER = "localhost"
MQTT_TOPICS = {
    "상쾌": "zigbee2mqtt/sangkwai",
    "편안": "zigbee2mqtt/pyeonan",
    "행복": "zigbee2mqtt/haengbok",
    "두뇌": "zigbee2mqtt/dunoe",
    "감각": "zigbee2mqtt/gamgak",
    "처음1": "zigbee2mqtt/cheoum1",
    "처음2": "zigbee2mqtt/cheoum2",
    "미소": "zigbee2mqtt/miso",
    "cheoum1_2": "zigbee2mqtt/cheoum1_2"
}

ACTION_MAP = {
    "1_single": (900, "침"),  # 15분
    "1_hold": (600, "침"),
    "2_single": (900, "부항"),
    "2_hold": (600, "부항"),
    "3_single": (900, "뜸"),
    "3_hold": (600, "뜸"),
    "4_single": (None, "리셋"),
    "4_hold": (0, "대기중")
}

logging.basicConfig(level=logging.DEBUG)
SOCKETIO_URL = "http://localhost:3001/"

print("Trying to connect to:", SOCKETIO_URL)
sio = socketio.Client(logger=True, engineio_logger=True)

@sio.event
def connect():
    print("✅ Socket.IO 서버에 연결됨")

@sio.event
def connect_error(data):
    print("❌ 연결 오류:", data)

@sio.event
def disconnect():
    print("🚪 서버에서 연결 해제됨")

@sio.on("timerState")
def on_timer_state(data):
    room = data["room"]
    state = data["state"]
    isRunning = "🟢" if state["isRunning"] else "⚪"
    label = state.get("label", "")
    timeLeft = state.get("timeLeft", 0)
    minutes = timeLeft // 60
    seconds = timeLeft % 60
    duration = state.get("duration", 0) // 60
    print(f"| {room:4} | {isRunning} | {label:4} | {minutes:02}:{seconds:02} / {duration:02}분 |")

try:
    sio.connect(SOCKETIO_URL)
except Exception as e:
    print("🔥 connect() 실패:", e)

def on_connect(client, userdata, flags, rc):
    print(f"🛰 MQTT Connected with result code {rc}")
    client.subscribe("zigbee2mqtt/#")  # 전체 구독

def on_message(client, userdata, msg):
    if msg.topic.startswith("zigbee2mqtt/bridge"):
        return  # bridge 관련은 무시
    print(f"🔥 MQTT Message received on {msg.topic}: {msg.payload}")
    try:
        payload = json.loads(msg.payload)
    except json.JSONDecodeError:
        print("⚠️ JSON decode 실패:", msg.payload)
        return

    if not isinstance(payload, dict):
        print("⚠️ payload dict 아님, 무시:", payload)
        return

    action = payload.get("action")
    if not action:
        print("⚠️ action 없음, 무시")
        return

    # 1. 심리/원장 신호 처리 (room_map)
    room_map = {
        "s_sim": "상쾌", "s_won": "상쾌",
        "p_sim": "편안", "p_won": "편안",
        "h_sim": "행복", "h_won": "행복",
        "d_sim": "두뇌", "d_won": "두뇌",
        "g_sim": "감각", "g_won": "감각",
        "m_sim": "미소", "m_won": "미소",
        "1_sim": "처음1", "1_won": "처음1",
        "2_sim": "처음2", "2_won": "처음2",
    }
    if msg.topic.startswith("zigbee2mqtt/"):
        topic_key = msg.topic.replace("zigbee2mqtt/", "")
        if topic_key in room_map:
            room = room_map[topic_key]
            # 심리(상담) 신호
            if topic_key.endswith("_sim"):
                if action == "single":
                    print(f"▶️ {room} 방(심리) 상담중 카운트업 타이머 시작")
                    sio.emit('startTimer', {"room": room, "duration": 0, "force": True, "label": "상담중"})
                elif action == "hold":
                    print(f"▶️ {room} 방(심리) 대기중 카운트업 타이머 시작 (상담완료 후)")
                    sio.emit('startTimer', {"room": room, "duration": 0, "force": True, "label": "대기중", "checkSimEnd": True})
                return
            # 원장(진료) 신호
            elif topic_key.endswith("_won"):
                if action == "single":
                    print(f"▶️ {room} 방(원장) 진료중 카운트업 타이머 시작")
                    sio.emit('startTimer', {"room": room, "duration": 0, "force": True, "label": "진료중"})
                elif action == "hold":
                    print(f"▶️ {room} 방(원장) 대기중 카운트업 타이머 시작 (진료완료 후)")
                    sio.emit('startTimer', {"room": room, "duration": 0, "force": True, "label": "대기중", "checkWonEnd": True})
                return

    # wonjang1 리모컨 전용 처리 (1~8 버튼 → 방 매핑)
    if msg.topic == "zigbee2mqtt/wonjang1":
        button_to_room = {
            "1": "상쾌",
            "2": "편안",
            "3": "행복",
            "4": "두뇌",
            "5": "감각",
            "6": "미소",
            "7": "처음1",
            "8": "처음2",
        }

        try:
            button_idx, event_type = action.split("_", 1)
        except ValueError:
            print(f"⚠️ wonjang1 action 파싱 실패: {action}")
            return

        room = button_to_room.get(button_idx)
        if not room:
            print(f"⚠️ wonjang1 알 수 없는 버튼: {button_idx}")
            return

        if event_type == "single":
            print(f"▶️ wonjang1 신호로 {room} 방에서 진료중 카운트업 타이머 시작")
            sio.emit('startTimer', {"room": room, "duration": 0, "force": True, "label": "진료중"})
        elif event_type == "long":
            print(f"▶️ wonjang1 신호로 {room} 방에서 대기중 카운트업 타이머 시작 (진료완료 후)")
            sio.emit('startTimer', {"room": room, "duration": 0, "force": True, "label": "대기중", "checkWonEnd": True})
        else:
            print(f"ℹ️ wonjang1 이벤트 무시: {action}")
        return

    # wonjang2 리모컨 전용 처리 (wonjang1과 동일 매핑)
    if msg.topic == "zigbee2mqtt/wonjang2":
        button_to_room = {
            "1": "상쾌",
            "2": "편안",
            "3": "행복",
            "4": "두뇌",
            "5": "감각",
            "6": "미소",
            "7": "처음1",
            "8": "처음2",
        }

        try:
            button_idx, event_type = action.split("_", 1)
        except ValueError:
            print(f"⚠️ wonjang2 action 파싱 실패: {action}")
            return

        room = button_to_room.get(button_idx)
        if not room:
            print(f"⚠️ wonjang2 알 수 없는 버튼: {button_idx}")
            return

        if event_type == "single":
            print(f"▶️ wonjang2 신호로 {room} 방에서 진료중 카운트업 타이머 시작")
            sio.emit('startTimer', {"room": room, "duration": 0, "force": True, "label": "진료중"})
        elif event_type == "long":
            print(f"▶️ wonjang2 신호로 {room} 방에서 대기중 카운트업 타이머 시작 (진료완료 후)")
            sio.emit('startTimer', {"room": room, "duration": 0, "force": True, "label": "대기중", "checkWonEnd": True})
        else:
            print(f"ℹ️ wonjang2 이벤트 무시: {action}")
        return

    # simri_child 리모컨 전용 처리 (상담 플로우: single=상담중, long=대기중(checkSimEnd))
    if msg.topic == "zigbee2mqtt/simri_child":
        button_to_room = {
            "1": "상쾌",
            "2": "편안",
            "3": "행복",
            "4": "두뇌",
            "5": "감각",
            "6": "미소",
            "7": "처음1",
            "8": "처음2",
        }

        try:
            button_idx, event_type = action.split("_", 1)
        except ValueError:
            print(f"⚠️ simri_child action 파싱 실패: {action}")
            return

        room = button_to_room.get(button_idx)
        if not room:
            print(f"⚠️ simri_child 알 수 없는 버튼: {button_idx}")
            return

        if event_type == "single":
            print(f"▶️ simri_child 신호로 {room} 방에서 상담중 카운트업 타이머 시작")
            sio.emit('startTimer', {"room": room, "duration": 0, "force": True, "label": "상담중"})
        elif event_type == "long":
            print(f"▶️ simri_child 신호로 {room} 방에서 대기중 카운트업 타이머 시작 (상담완료 후)")
            sio.emit('startTimer', {"room": room, "duration": 0, "force": True, "label": "대기중", "checkSimEnd": True})
        else:
            print(f"ℹ️ simri_child 이벤트 무시: {action}")
        return

    # 2. cheoum1_2 및 일반 ACTION_MAP 처리
    if msg.topic == "zigbee2mqtt/cheoum1_2":
        room = "cheoum1_2"
    else:
        # MQTT_TOPICS에서 room 찾기
        room = next((room for room, topic in MQTT_TOPICS.items() if topic == msg.topic), None)
        if not room:
            print("⚠️ 알 수 없는 topic:", msg.topic)
            return

    if action not in ACTION_MAP:
        print("⚠️ 알 수 없는 action:", action)
        return

    duration, label = ACTION_MAP[action]
    if label == "리셋":
        print(f"🧹 {room} 방 리셋 요청")
        sio.emit('resetTimer', {"room": room})
        return

    # cheoum1_2 특별 처리
    if room == "cheoum1_2":
        if action == "1_single":
            print(f"▶️ cheoum1_2 신호로 처음1 방에서 상담중 카운트업 타이머 시작")
            sio.emit('startTimer', {"room": "처음1", "duration": 0, "force": True, "label": "상담중"})
        elif action == "1_hold":
            print(f"▶️ cheoum1_2 신호로 처음1 방에서 대기중 카운트업 타이머 시작 (상담완료 후)")
            sio.emit('startTimer', {"room": "처음1", "duration": 0, "force": True, "label": "대기중", "checkSimEnd": True})
        elif action == "2_single":
            print(f"▶️ cheoum1_2 신호로 처음1 방에서 진료중 카운트업 타이머 시작")
            sio.emit('startTimer', {"room": "처음1", "duration": 0, "force": True, "label": "진료중"})
        elif action == "2_hold":
            print(f"▶️ cheoum1_2 신호로 처음1 방에서 대기중 카운트업 타이머 시작 (진료완료 후)")
            sio.emit('startTimer', {"room": "처음1", "duration": 0, "force": True, "label": "대기중", "checkWonEnd": True})
        elif action == "3_single":
            print(f"▶️ cheoum1_2 신호로 처음1 방에서 검사중 카운트업 타이머 시작")
            sio.emit('startTimer', {"room": "처음1", "duration": 0, "force": True, "label": "검사중"})
        elif action == "3_hold":
            print(f"▶️ cheoum1_2 신호로 처음1 방에서 대기중 카운트업 타이머 시작 (검사완료 후)")
            sio.emit('startTimer', {"room": "처음1", "duration": 0, "force": True, "label": "대기중", "checkTestEnd": True})
        elif action == "4_single":
            print(f"▶️ cheoum1_2 신호로 처음1 방에서 안내중 카운트업 타이머 시작 (비용설명중)")
            sio.emit('startTimer', {"room": "처음1", "duration": 0, "force": True, "label": "안내중"})
        elif action == "4_hold":
            print(f"▶️ cheoum1_2 신호로 처음1 방에서 대기중 카운트업 타이머 시작 (비용안내 후)")
            sio.emit('startTimer', {"room": "처음1", "duration": 0, "force": True, "label": "대기중", "checkCostEnd": True})
        else:
            print(f"⚠️ cheoum1_2 알 수 없는 action: {action}")
        return

    # 3. 일반 ACTION_MAP 처리 (cheoum1_2가 아닌 경우)
    print(f"▶️ {room} 방에서 {label} {duration//60 if duration else 0}분 타이머 시작")
    sio.emit('startTimer', {"room": room, "duration": duration, "force": True, "label": label})

client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message

client.connect(MQTT_BROKER, 1883, 60)
client.loop_forever()  # 무한 loop, while True 필요 없음
