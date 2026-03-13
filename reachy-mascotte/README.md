# Reachy Mini - DataLab Mascotte

Interactieve robot-mascotte voor het DataLab aan de HAN. Reachy luistert naar mensen (spraakherkenning), denkt na via een LLM, en antwoordt met spraak terwijl hij expressieve bewegingen maakt en personen volgt met zijn hoofd.

## Architectuur

```
Microfoon (Reachy Audio) -> Google STT -> Claude Haiku 4.5 (via OpenRouter) -> Piper TTS -> Speaker (Reachy Audio)
                                                                                    |
                                                    Camera (Reachy) -> PersonTracker -> Hoofdbewegingen
```

## Hardware

- **Robot**: Reachy Mini (Pollen Robotics) - Stewart platform hoofd, body rotatie, 2 antennes
- **Computer**: Raspberry Pi 5
- **Camera**: Reachy Mini Camera (USB, 1920x1080 MJPG)
- **Audio**: Reachy Mini Audio (USB, mic + speaker op hw:3,0)
- **Motorcontroller**: via `/dev/ttyACM0`

## Software Stack

| Component | Technologie |
|-----------|------------|
| Robot SDK | `reachy_mini` v1.5.1 |
| LLM | Claude Haiku 4.5 via OpenRouter |
| TTS | Piper (lokaal, Belgisch Nederlands - Nathalie) |
| STT | Google Speech Recognition (via internet) |
| Tracking | OpenCV Haar Cascade (upper body) |
| Daemon | `reachy-mini-daemon` (draait apart) |

## Bestanden

| Bestand | Beschrijving |
|---------|-------------|
| `mascotte.py` | Hoofdscript - volledige mascotte met STT, LLM, TTS, tracking en bewegingen |
| `brain_test.py` | Test-script voor LLM + TTS via toetsenbord (geen mic nodig) |
| `praat_test.py` | Test-script voor alleen TTS |
| `start_mascotte.sh` | Launcher script (activeert venv, onderdrukt ALSA warnings) |
| `requirements.txt` | Python dependencies |

## Installatie op de Raspberry Pi

### 1. Daemon starten

```bash
cd /home/medialab/reachy_project
source venv/bin/activate
reachy-mini-daemon -p /dev/ttyACM0 --wake-up-on-start --log-level INFO
```

### 2. Piper TTS installeren

Download Piper voor aarch64 en een Nederlands stemmodel:

```bash
mkdir -p piper && cd piper
wget https://github.com/rhasspy/piper/releases/download/v1.2.0/piper_linux_aarch64.tar.gz
tar xzf piper_linux_aarch64.tar.gz

# Belgisch Nederlands (Nathalie) stemmodel
wget -O model.onnx "https://huggingface.co/rhasspy/piper-voices/resolve/main/nl/nl_BE-nathalie-medium/nl_BE-nathalie-medium.onnx"
wget -O model.onnx.json "https://huggingface.co/rhasspy/piper-voices/resolve/main/nl/nl_BE-nathalie-medium/nl_BE-nathalie-medium.onnx.json"
```

### 3. Systeempakketten

```bash
sudo apt-get install -y flac portaudio19-dev python3-pyaudio
```

### 4. Python dependencies

```bash
pip install -r requirements.txt
```

### 5. Audio configuratie

Stel het volume in en controleer de mic:

```bash
# Speaker volume op 100%
amixer -c 3 set 'PCM' 100%

# Test mic
arecord -D hw:3,0 -d 3 -f S16_LE -r 16000 test.wav
aplay -D plughw:3,0 test.wav
```

## Gebruik

### Volledige mascotte starten

```bash
./start_mascotte.sh
```

Of handmatig:

```bash
cd /home/medialab/reachy_project
source venv/bin/activate
python3 mascotte.py 2>/dev/null
```

### Stoppen

Zeg "stop", "slapen" of "exit", of druk op Ctrl+C.

### Alleen TTS testen

```bash
python3 praat_test.py
```

### LLM + TTS testen (via toetsenbord)

```bash
python3 brain_test.py
```

## Configuratie

In `mascotte.py` bovenaan:

```python
API_KEY = "sk-or-v1-..."          # OpenRouter API key
MIC_INDEX = 2                      # Microfoon device index
LLM_MODEL_SNEL = "anthropic/claude-haiku-4.5"
```

## Bekende beperkingen

- ALSA warnings verschijnen in de terminal (onschadelijk, onderdrukt via `2>/dev/null`)
- Camera zit in de borst van de robot, gezichten vallen buiten beeld. Daarom wordt upper body tracking gebruikt in plaats van face tracking.
- Google STT vereist een internetverbinding
- De `energy_threshold` van de microfoon (300) moet mogelijk worden aangepast afhankelijk van de omgeving
