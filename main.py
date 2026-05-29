# main.py

import threading
import webbrowser
import http.server
import socketserver
from pathlib import Path

from config import (
    SCENARIOS,
    DESIGNS,
    FUELS,
    DEFAULT_SFOC_G_PER_KWH_BY_MODE,
    DEFAULT_FUEL_KEY,
)

from report.html_dashboard import write_environment_dashboard


PORT = 8000
REL_PATH = Path("report") / "dashboard.html"


def serve():
    # Starts a simple local server for viewing the dashboard
    handler = http.server.SimpleHTTPRequestHandler

    with socketserver.TCPServer(("", PORT), handler) as httpd:
        httpd.serve_forever()


def main():
    # Creates the output folder if it does not already exist
    out = REL_PATH
    out.parent.mkdir(parents=True, exist_ok=True)

    # Writes the dashboard HTML using the configured case study data
    write_environment_dashboard(
        out_path=str(out),
        scenarios=SCENARIOS,
        designs=DESIGNS,
        fuels=FUELS,
        default_sfoc_by_mode=DEFAULT_SFOC_G_PER_KWH_BY_MODE,
        default_fuel_key=DEFAULT_FUEL_KEY,
    )

    # Runs the server in the background so the browser can open the file
    t = threading.Thread(target=serve, daemon=True)
    t.start()

    # Opens the generated dashboard in the default browser
    url = f"http://localhost:{PORT}/{REL_PATH.as_posix()}"
    print(f"Opening dashboard at: {url}")
    webbrowser.open(url)


if __name__ == "__main__":
    main()