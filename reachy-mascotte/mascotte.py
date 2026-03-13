import subprocess
import sys
import time
import os
import re
import ctypes
import threading
import numpy as np
import cv2
import speech_recognition as sr
from dotenv import load_dotenv
from openai import OpenAI
from reachy_mini import ReachyMini
from scipy.spatial.transform import Rotation as R

# Onderdruk ALSA en JACK warnings
try:
    asound = ctypes.cdll.LoadLibrary('libasound.so.2')
    asound.snd_lib_error_set_handler(ctypes.c_void_p(0))
except:
    pass
os.environ['PYTHONUNBUFFERED'] = '1'
load_dotenv()

# Kill oude mascotte processen (behalve onszelf)
_mijn_pid = os.getpid()
try:
    _pids = subprocess.check_output(
        "pgrep -f 'python3 mascotte.py'", shell=True, text=True
    ).strip().split('\n')
    for _pid in _pids:
        _pid = int(_pid.strip())
        if _pid != _mijn_pid:
            os.kill(_pid, 9)
            print(f"Oud mascotte-proces {_pid} gestopt.")
except Exception:
    pass
time.sleep(0.5)

# ==========================================
#              CONFIGURATIE
# ==========================================

API_KEY = os.getenv("OPENROUTER_API_KEY")

PIPER_EXE = "./piper/piper/piper"
TTS_MODEL = "./piper/model.onnx"
MIC_INDEX = 2  # Reachy Mini Audio: USB Audio (hw:3,0)

LLM_MODEL_SNEL = "anthropic/claude-haiku-4.5"
# LLM_MODEL_NIEUWS = "perplexity/llama-3.1-sonar-small-128k-online"
# NIEUWS_WOORDEN = ['nieuws', 'recent', 'vandaag', 'deze week', 'actueel', 'trending', 'laatste']

# ==========================================
#              VERBINDINGEN
# ==========================================

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=API_KEY
)

print("Verbinden met Reachy Mini daemon...")
try:
    reachy = ReachyMini(media_backend="no_media")
    print("Hardware verbonden!")
except Exception as e:
    print(f"Kon geen verbinding maken met de robot: {e}")
    print("Draait 'reachy-mini-daemon' in een ander venster?")
    sys.exit()

# ==========================================
#              HULPFUNCTIES
# ==========================================

INIT_POSE = np.eye(4)

def maak_hoofd_pose(roll=0, pitch=0, yaw=0):
    """Maak een 4x4 pose matrix van roll/pitch/yaw in graden."""
    pose = np.eye(4)
    pose[:3, :3] = R.from_euler("xyz", [roll, pitch, yaw], degrees=True).as_matrix()
    return pose

# ==========================================
#              FACE TRACKING
# ==========================================

YUNET_MODEL = "./face_detection_yunet.onnx"

class PersonTracker:
    DETECT_W = 640
    DETECT_H = 360
    GAIN_YAW = 4.0
    MAX_YAW = 35

    def __init__(self, reachy, camera_device='/dev/video0'):
        self.reachy = reachy
        self.camera_device = camera_device
        self.actief = False
        self._thread = None
        self._stop_event = threading.Event()
        self.huidige_yaw = 0.0

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self.actief = True
        self.huidige_yaw = 0.0
        self._thread = threading.Thread(target=self._track_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self.actief = False
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=3)

    def _track_loop(self):
        cap = cv2.VideoCapture(self.camera_device, cv2.CAP_V4L2)
        if not cap.isOpened():
            print("[Tracking] Camera kon niet geopend worden!")
            return

        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc('M','J','P','G'))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
        cap.set(cv2.CAP_PROP_FPS, 30)

        ret, frame = cap.read()
        if not ret:
            print("[Tracking] Camera geeft geen frames!")
            cap.release()
            return

        # YuNet DNN face detector - veel robuuster dan Haar cascades
        detector = cv2.FaceDetectorYN.create(
            YUNET_MODEL, "", (self.DETECT_W, self.DETECT_H), 0.5, 0.3, 5000
        )
        print(f"[Tracking] Camera OK + YuNet geladen")

        geen_gezicht_teller = 0

        while not self._stop_event.is_set():
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.1)
                continue

            if not self.actief:
                time.sleep(0.1)
                continue

            klein = cv2.resize(frame, (self.DETECT_W, self.DETECT_H))
            _, faces = detector.detect(klein)

            if faces is not None and len(faces) > 0:
                geen_gezicht_teller = 0
                # Pak het gezicht met de hoogste score
                best = max(faces, key=lambda f: f[-1])
                x, w = int(best[0]), int(best[2])
                center_u = x + w // 2

                fout_x = (center_u - self.DETECT_W / 2) / (self.DETECT_W / 2)

                self.huidige_yaw -= fout_x * self.GAIN_YAW
                self.huidige_yaw = max(-self.MAX_YAW, min(self.MAX_YAW, self.huidige_yaw))

                try:
                    pose = maak_hoofd_pose(yaw=self.huidige_yaw)
                    self.reachy.set_target(head=pose)
                except Exception:
                    pass
            else:
                geen_gezicht_teller += 1
                if geen_gezicht_teller > 15:
                    self.huidige_yaw *= 0.9
                    try:
                        pose = maak_hoofd_pose(yaw=self.huidige_yaw)
                        self.reachy.set_target(head=pose)
                    except Exception:
                        pass

            time.sleep(0.15)

        cap.release()
        print("[Tracking] Gestopt.")

# ==========================================
#              ROBOT FUNCTIES
# ==========================================

def word_wakker():
    """Startpositie: hoofd recht, antennes blij."""
    print("Reachy wordt wakker...")
    reachy.goto_target(head=INIT_POSE, antennas=[0.35, -0.35], duration=1.0)
    time.sleep(0.5)

def luister_houding():
    """Houding tijdens het luisteren: iets naar voren, antennes alert."""
    reachy.goto_target(
        head=maak_hoofd_pose(pitch=5),
        antennas=[0.17, -0.17],
        duration=0.5
    )

def schoon_tekst(tekst):
    """Maak tekst geschikt voor spraaksynthese."""
    clean = re.sub(r'[*#"()_~`\[\]{}|<>\\]', '', tekst)
    clean = re.sub(r'https?://\S+', '', clean)
    clean = re.sub(r'\S+@\S+\.\S+', lambda m: m.group().replace('.', ' punt ').replace('@', ' at '), clean)
    clean = re.sub(r'\s+', ' ', clean).strip()
    return clean

def spreek_zin(tekst):
    """Spreek een enkele zin uit via Piper TTS."""
    clean = schoon_tekst(tekst)
    if not clean:
        return
    cmd = f'echo "{clean}" | {PIPER_EXE} --model {TTS_MODEL} --output_file - | aplay -D plughw:3,0'
    subprocess.run(cmd, shell=True, stderr=subprocess.DEVNULL)

def zeg(tekst):
    """Laat de robot de tekst uitspreken via Piper + beweging."""
    if not tekst:
        return

    print(f"\nReachy zegt: {tekst}")

    # Antennes omhoog tijdens praten
    reachy.goto_target(
        head=maak_hoofd_pose(pitch=-3),
        antennas=[0.7, -0.7],
        duration=0.5
    )

    spreek_zin(tekst)

    # Terug naar neutrale stand
    reachy.goto_target(
        head=INIT_POSE,
        antennas=[0.35, -0.35],
        duration=0.5
    )

def luister():
    """Luister via de microfoon en zet om naar tekst via Google STT."""
    r = sr.Recognizer()
    r.energy_threshold = 300  # Lagere drempel = gevoeliger voor zachte mic
    r.dynamic_energy_threshold = False

    try:
        with sr.Microphone(device_index=MIC_INDEX) as source:
            luister_houding()
            print("\nIk luister... (Spreek nu)")

            r.adjust_for_ambient_noise(source, duration=1.0)
            audio = r.listen(source, timeout=10, phrase_time_limit=15)

            print("Herkennen...")
            tekst = r.recognize_google(audio, language="nl-NL")
            print(f"Gehoord: '{tekst}'")
            return tekst

    except sr.WaitTimeoutError:
        print("...ik hoorde niets...")
        return None
    except sr.UnknownValueError:
        print("...ik verstond het niet...")
        return None
    except Exception as e:
        print(f"Microfoon fout: {e}")
        return None

def vraag_brein_streaming(geschiedenis):
    """Stream het LLM-antwoord en spreek per zin uit."""
    # Nadenk-houding
    reachy.goto_target(
        head=maak_hoofd_pose(pitch=10),
        antennas=[0.0, 0.0],
        duration=0.3
    )

    print(f"Vraag stellen aan {LLM_MODEL_SNEL}...")

    try:
        stream = client.chat.completions.create(
            model=LLM_MODEL_SNEL,
            messages=geschiedenis,
            stream=True
        )

        buffer = ""
        volledig_antwoord = ""
        eerste_zin = True

        for chunk in stream:
            delta = chunk.choices[0].delta
            if delta.content:
                buffer += delta.content
                volledig_antwoord += delta.content

                # Check of er een complete zin in de buffer zit
                while re.search(r'[.!?]\s', buffer) or (buffer.endswith(('.', '!', '?')) and chunk.choices[0].finish_reason):
                    match = re.search(r'[.!?]\s', buffer)
                    if match:
                        zin = buffer[:match.end()].strip()
                        buffer = buffer[match.end():]
                    else:
                        zin = buffer.strip()
                        buffer = ""

                    if zin:
                        print(f"  > {zin}")
                        if eerste_zin:
                            # Praat-houding bij eerste zin
                            reachy.goto_target(
                                head=maak_hoofd_pose(pitch=-3),
                                antennas=[0.7, -0.7],
                                duration=0.5
                            )
                            eerste_zin = False
                        spreek_zin(zin)

                    if not buffer:
                        break

        # Resterende tekst in buffer uitspreken
        if buffer.strip():
            print(f"  > {buffer.strip()}")
            if eerste_zin:
                reachy.goto_target(
                    head=maak_hoofd_pose(pitch=-3),
                    antennas=[0.7, -0.7],
                    duration=0.5
                )
            spreek_zin(buffer.strip())

        # Terug naar neutrale stand
        reachy.goto_target(
            head=INIT_POSE,
            antennas=[0.35, -0.35],
            duration=0.5
        )

        return volledig_antwoord

    except Exception as e:
        fout = f"Oeps, mijn brein werkt even niet. Fout: {e}"
        zeg(fout)
        return fout

# ==========================================
#              HOOFD PROGRAMMA
# ==========================================

def main():
    word_wakker()

    # Start face tracking
    tracker = PersonTracker(reachy, camera_device='/dev/video0')
    tracker.start()
    time.sleep(1)  # Geef camera tijd om te starten

    # Status check
    print("\n=== SYSTEEM STATUS ===")
    print(f"  Robot:      verbonden")
    print(f"  LLM:        {LLM_MODEL_SNEL}")
    print(f"  TTS:        Piper ({TTS_MODEL})")
    print(f"  STT:        Google (mic index {MIC_INDEX})")
    print(f"  Camera:     {'actief' if tracker._thread and tracker._thread.is_alive() else 'NIET ACTIEF'}")
    print("======================\n")

    system_prompt = """Je bent Reachy, de fysieke robot-mascotte van het DataLab aan de HAN. Je spreekt Nederlands. Je toon is enthousiast, behulpzaam, en een tikkeltje nerdy. Je bent er om onderzoekers te helpen en inspireren.

STRENGE REGELS VOOR JE ANTWOORDEN:
- Maximaal 2 zinnen per antwoord.
- NOOIT emoji gebruiken. Geen enkele emoji.
- NOOIT markdown of opmaak gebruiken. Geen sterretjes, geen bullets, geen hekjes, geen vetgedrukt.
- Schrijf gewone, vlakke tekst. Jouw antwoorden worden hardop voorgelezen door een spraaksynthesizer.
- Weet je iets niet? Verwijs naar DataLab@han.nl of han.nl/demolabs.

WAT HET DATALAB DOET (noem niet alles tegelijk, alleen als het relevant is):
- SURF Research Cloud voor zware berekeningen en cloud-werkplekken.
- AI tools en ondersteuning bij modellen en data-analyse.
- Rekenkracht voor als je eigen laptop het niet meer trekt.
- Advies voor onderzoekers over data en AI tools."""

    chat_history = [{"role": "system", "content": system_prompt}]

    start_zin = "Hallo DataLab! Ik ben online en klaar voor actie."
    chat_history.append({"role": "assistant", "content": start_zin})
    zeg(start_zin)

    while True:
        try:
            user_input = luister()

            if not user_input:
                word_wakker()
                continue

            if any(woord in user_input.lower() for woord in ['stop', 'slapen', 'exit']):
                tracker.stop()
                zeg("Oke, ik ga slapen. Tot ziens!")
                reachy.goto_sleep()
                break

            chat_history.append({"role": "user", "content": user_input})
            tracker.actief = False  # Pauzeer tracking tijdens denken/praten
            antwoord = vraag_brein_streaming(chat_history)
            chat_history.append({"role": "assistant", "content": antwoord})
            tracker.actief = True  # Hervat tracking

        except KeyboardInterrupt:
            print("\nGestopt door gebruiker.")
            tracker.stop()
            reachy.goto_sleep()
            break

if __name__ == "__main__":
    main()
