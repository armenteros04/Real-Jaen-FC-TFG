"""
Recodifica todos los .mp4 de la carpeta OUTPUTS a un formato que los
navegadores puedan reproducir (H.264 + AAC, con el átomo 'moov' al
principio del archivo para que se pueda hacer streaming/seek).

Por qué hace falta:
  Si los vídeos se generaron con cv2.VideoWriter (OpenCV), suelen quedar
  codificados en 'mp4v' u otros códecs que NINGÚN navegador sabe
  decodificar para la etiqueta <video>. El archivo se descarga bien
  (verás 200/206 en la pestaña Red), pero el reproductor se queda
  congelado en 0:00 sin mostrar nada ni dar ningún error.

Requisitos:
  - Tener ffmpeg y ffprobe instalados y accesibles en el PATH.
    (Windows: https://www.gyan.dev/ffmpeg/builds/ , añadir la carpeta bin al PATH)
    (Linux:  sudo apt install ffmpeg)
    (macOS:  brew install ffmpeg)

Uso:
    python convert_videos.py
"""
import os
import glob
import shutil
import subprocess

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUTS_DIR = os.path.join(BASE_DIR, "OUTPUTS")


def is_browser_compatible(path: str) -> bool:
    """Comprueba con ffprobe si el vídeo ya está en H.264."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=codec_name",
                "-of", "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            capture_output=True, text=True, check=True,
        )
        return result.stdout.strip().lower() == "h264"
    except FileNotFoundError:
        raise RuntimeError(
            "No se encontró 'ffprobe'. Instala ffmpeg y añádelo al PATH."
        )
    except subprocess.CalledProcessError as e:
        print(f"  ! No se pudo leer el códec de {path}: {e.stderr.strip()}")
        return False


def convert_to_h264(path: str) -> None:
    """Recodifica el vídeo in-place a H.264/AAC con faststart."""
    tmp_path = path + ".tmp.mp4"
    cmd = [
        "ffmpeg", "-y", "-i", path,
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-c:a", "aac", "-b:a", "128k",
        tmp_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        # Limpieza si algo falló a medias
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise RuntimeError(result.stderr[-600:])
    shutil.move(tmp_path, path)


def main():
    videos = sorted(glob.glob(os.path.join(OUTPUTS_DIR, "**", "*.mp4"), recursive=True))
    if not videos:
        print(f"No se encontraron .mp4 en {OUTPUTS_DIR}.")
        return

    print(f"Encontrados {len(videos)} vídeo(s) en OUTPUTS. Comprobando compatibilidad…\n")

    fixed, ok, failed = 0, 0, 0
    for path in videos:
        rel = os.path.relpath(path, OUTPUTS_DIR)
        try:
            if is_browser_compatible(path):
                print(f"[OK]   {rel} — ya es H.264, no se toca.")
                ok += 1
                continue
        except RuntimeError as e:
            print(f"[ERROR] {e}")
            return

        print(f"[FIX]  {rel} — recodificando a H.264…")
        try:
            convert_to_h264(path)
            print(f"       ✅ Recodificado correctamente.")
            fixed += 1
        except RuntimeError as e:
            print(f"       ❌ Error al recodificar:\n{e}")
            failed += 1

    print(f"\nResumen: {ok} ya compatibles, {fixed} recodificados, {failed} con error.")


if __name__ == "__main__":
    main()
