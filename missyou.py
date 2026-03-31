import os
import sys
import threading
import time
import webbrowser
import requests
import mimetypes

# --- PYINSTALLER FIX: Redirect stdout to prevent 'isatty' crashes ---
if sys.stdout is None:
    sys.stdout = open(os.devnull, 'w')
if sys.stderr is None:
    sys.stderr = open(os.devnull, 'w')

from app import app 

PORT = 5000
URL = f"http://127.0.0.1:{PORT}"

def start_server():
    import logging
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)
    # Ensure mimetypes are mapped before starting
    mimetypes.add_type('text/css', '.css')
    mimetypes.add_type('application/javascript', '.js')
    app.run(host='127.0.0.1', port=PORT, debug=False, use_reloader=False)

def wait_for_server_and_open_browser():
    timeout = 20
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            # Ping the config check route to see if server is up
            response = requests.get(URL + "/api/check_config")
            if response.status_code == 200:
                webbrowser.open(URL)
                return
        except requests.ConnectionError:
            time.sleep(0.5)

if __name__ == '__main__':
    # Set the working directory to the temporary folder PyInstaller creates
    if getattr(sys, 'frozen', False):
        os.chdir(sys._MEIPASS)

    # Start Flask in background
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    # Open browser once ready
    wait_for_server_and_open_browser()

    # Keep main thread alive
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        sys.exit(0)