"""Serve only the demo frontend on localhost, without logging OAuth query strings."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


class DemoHandler(SimpleHTTPRequestHandler):
    def log_request(self, code="-", size="-"):
        # The OAuth callback contains a short-lived authorization code in its URL.
        print(f"{self.command} {urlsplit(self.path).path} {code}", flush=True)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


if __name__ == "__main__":
    directory = Path(__file__).resolve().parents[1] / "web"
    server = ThreadingHTTPServer(("127.0.0.1", 8080), partial(DemoHandler, directory=str(directory)))
    print("Open http://localhost:8080/ — Ctrl+C stops the demo.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
