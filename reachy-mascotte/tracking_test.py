"""Snelle test: camera + YuNet face detection (geen robot nodig)."""
import cv2
import time

YUNET_MODEL = "./face_detection_yunet.onnx"
DETECT_W = 640
DETECT_H = 360

cap = cv2.VideoCapture('/dev/video0', cv2.CAP_V4L2)
if not cap.isOpened():
    print("Camera kon niet geopend worden!")
    exit(1)

cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc('M','J','P','G'))
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
cap.set(cv2.CAP_PROP_FPS, 30)

ret, frame = cap.read()
if not ret:
    print("Camera geeft geen frames!")
    cap.release()
    exit(1)

print(f"Camera OK: {frame.shape}")

detector = cv2.FaceDetectorYN.create(YUNET_MODEL, "", (DETECT_W, DETECT_H), 0.5, 0.3, 5000)
print("YuNet geladen!")

for i in range(30):
    ret, frame = cap.read()
    if not ret:
        continue

    klein = cv2.resize(frame, (DETECT_W, DETECT_H))
    _, faces = detector.detect(klein)

    if faces is not None and len(faces) > 0:
        for f in faces:
            x, y, w, h = int(f[0]), int(f[1]), int(f[2]), int(f[3])
            score = f[-1]
            cx = x + w // 2
            fout = (cx - DETECT_W / 2) / (DETECT_W / 2)
            print(f"  Frame {i:2d}: Gezicht op ({x},{y}) {w}x{h} score={score:.2f} fout_x={fout:+.2f}")
    else:
        print(f"  Frame {i:2d}: Geen gezicht")

    time.sleep(0.2)

cap.release()
print("Klaar!")
