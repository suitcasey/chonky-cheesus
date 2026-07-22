#!/usr/bin/env python3
"""
Chonky Cheesus cult server — static files + public flex API.

  python3 server.py
  open http://127.0.0.1:8787/newchonky.html

Endpoints:
  GET  /api/health
  GET  /api/world
  POST /api/belief            { kind, clientId }  kind: rite|sanctum|fragment
  GET  /api/whispers
  POST /api/whispers          { message, username?, fragments, clientId }
  POST /api/whispers/<id>/amplify  { clientId }
  GET  /api/saints
  POST /api/saints            { name, rank, fragments, sanctum, forbidden, clientId }
"""

from __future__ import annotations

import json
import os
import re
import threading
import uuid
from datetime import date, datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("CHONKY_DATA_DIR", str(ROOT / "data")))
STORE_PATH = DATA_DIR / "cult_store.json"
# Platforms (Render/Railway/Fly) set PORT; local default 8787
PORT = int(os.environ.get("PORT") or os.environ.get("CHONKY_PORT") or "8787")
# 0.0.0.0 = reachable from the internet when hosted; local still works
HOST = os.environ.get("HOST", "0.0.0.0")

LOCK = threading.Lock()

# Soft limits
MAX_MESSAGE_LEN = 280
MAX_NAME_LEN = 24
DAILY_AMPLIFIES = 7
MIN_FRAGMENTS_TO_POST = 7
MIN_FRAGMENTS_TO_CLAIM = 7
MAX_WHISPERS = 500
MAX_SAINTS = 300

# The Thinning — shared world weather
MAX_THICKNESS = 100.0
MIN_THICKNESS = 0.0
DEFAULT_THICKNESS = 55.0
DECAY_PER_HOUR = 1.25
BELIEF_POINTS = {
    "whisper": 2.0,
    "amplify": 1.0,
    "claim": 4.0,
    "rite": 3.0,
    "sanctum": 8.0,
    "fragment": 0.75,
    "canon": 5.0,
}
# Soft rate limit: belief events per client per day (rite/sanctum/fragment)
MAX_BELIEF_EVENTS_PER_DAY = 24


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


def default_store() -> dict:
    return {
        "whispers": [],
        "saints": [],
        "amplify_log": {},
        "world": {
            "thickness": DEFAULT_THICKNESS,
            "lastBeliefAt": utc_now(),
            "lastDecayAt": utc_now(),
        },
        "belief_log": {},
    }


def load_store() -> dict:
    DATA_DIR.mkdir(exist_ok=True)
    if not STORE_PATH.exists():
        store = default_store()
        save_store(store)
        return store
    try:
        with STORE_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        data.setdefault("whispers", [])
        data.setdefault("saints", [])
        data.setdefault("amplify_log", {})
        data.setdefault("belief_log", {})
        world = data.setdefault("world", {})
        world.setdefault("thickness", DEFAULT_THICKNESS)
        world.setdefault("lastBeliefAt", utc_now())
        world.setdefault("lastDecayAt", utc_now())
        return data
    except (json.JSONDecodeError, OSError):
        return default_store()


def save_store(store: dict) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    tmp = STORE_PATH.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(store, f, indent=2, ensure_ascii=False)
    tmp.replace(STORE_PATH)


def apply_decay(store: dict) -> None:
    world = store.setdefault("world", {})
    now = datetime.now(timezone.utc)
    last = parse_iso(world.get("lastDecayAt")) or now
    hours = max(0.0, (now - last).total_seconds() / 3600.0)
    if hours <= 0:
        return
    thickness = float(world.get("thickness", DEFAULT_THICKNESS))
    thickness = max(MIN_THICKNESS, thickness - hours * DECAY_PER_HOUR)
    world["thickness"] = round(thickness, 2)
    world["lastDecayAt"] = now.isoformat()


def thicken(store: dict, kind: str, amount: float | None = None) -> dict:
    apply_decay(store)
    world = store.setdefault("world", {})
    pts = amount if amount is not None else BELIEF_POINTS.get(kind, 1.0)
    thickness = float(world.get("thickness", DEFAULT_THICKNESS)) + pts
    world["thickness"] = round(min(MAX_THICKNESS, max(MIN_THICKNESS, thickness)), 2)
    world["lastBeliefAt"] = utc_now()
    return world_snapshot(store)


def world_tier(thickness: float) -> str:
    if thickness >= 75:
        return "sacred"
    if thickness >= 50:
        return "thick"
    if thickness >= 30:
        return "waning"
    if thickness >= 12:
        return "thin"
    return "critical"


def world_copy(tier: str) -> tuple[str, str]:
    """Return (label, threat) for UI."""
    table = {
        "sacred": (
            "The cheese is sacred tonight. Belief has mass.",
            "The Thin Ones cannot find a seam.",
        ),
        "thick": (
            "The cheese is thick. The myth holds.",
            "The Thin Ones watch from the comments.",
        ),
        "waning": (
            "The cheese is waning. Something is sanding the edges.",
            "The Thin Ones whisper of utility and roadmaps.",
        ),
        "thin": (
            "The cheese is thin. Color drains from the gospel.",
            "The Thin Ones rewrite history as a whitepaper.",
        ),
        "critical": (
            "Critical thinning. Stay — or the myth forgets itself.",
            "The Thin Ones almost won. Believe harder.",
        ),
    }
    return table.get(tier, table["thick"])


def world_snapshot(store: dict) -> dict:
    apply_decay(store)
    world = store.get("world", {})
    thickness = float(world.get("thickness", DEFAULT_THICKNESS))
    tier = world_tier(thickness)
    label, threat = world_copy(tier)
    return {
        "thickness": thickness,
        "tier": tier,
        "label": label,
        "threat": threat,
        "lastBeliefAt": world.get("lastBeliefAt"),
        "max": MAX_THICKNESS,
    }


def canon_required(whisper_count_canon: int) -> int:
    return 12 + whisper_count_canon * 4


def sanitize_name(name: str | None) -> str | None:
    if not name:
        return None
    cleaned = re.sub(r"\s+", " ", str(name)).strip()
    if not cleaned:
        return None
    return cleaned[:MAX_NAME_LEN]


def sanitize_message(msg: str) -> str:
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", str(msg)).strip()
    return cleaned[:MAX_MESSAGE_LEN]


def client_day_key(client_id: str) -> str:
    return f"{client_id}:{date.today().isoformat()}"


class CultHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        # Quieter logs
        sys_stderr = __import__("sys").stderr
        sys_stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > 50_000:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
            return data if isinstance(data, dict) else {}
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        # Friendly entrypoints
        if path in ("/", "/index.html", "/index"):
            self.send_response(302)
            self.send_header("Location", "/newchonky.html")
            self.end_headers()
            return

        if path == "/api/health":
            with LOCK:
                store = load_store()
                world = world_snapshot(store)
                save_store(store)
            return self.send_json(200, {"ok": True, "service": "chonky-cult", "time": utc_now(), "world": world})

        if path == "/api/world":
            with LOCK:
                store = load_store()
                world = world_snapshot(store)
                save_store(store)
            return self.send_json(200, {"world": world})

        if path == "/api/whispers":
            with LOCK:
                store = load_store()
                apply_decay(store)
                whispers = list(store["whispers"])
                save_store(store)
            return self.send_json(200, {"whispers": whispers})

        if path == "/api/saints":
            with LOCK:
                store = load_store()
                saints = sorted(
                    store["saints"],
                    key=lambda s: (
                        {"saint": 0, "disciple": 1, "believer": 2}.get(s.get("rank", ""), 9),
                        -int(s.get("thickness") or 0),
                        -int(s.get("streak") or 0),
                        s.get("claimedAt", ""),
                    ),
                )
            return self.send_json(200, {"saints": saints})

        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        data = self.read_json()

        if path == "/api/whispers":
            return self.handle_post_whisper(data)

        m = re.fullmatch(r"/api/whispers/([^/]+)/amplify", path)
        if m:
            return self.handle_amplify(m.group(1), data)

        if path == "/api/saints":
            return self.handle_claim_saint(data)

        if path == "/api/belief":
            return self.handle_belief(data)

        self.send_json(404, {"error": "not_found"})

    def handle_belief(self, data: dict) -> None:
        kind = str(data.get("kind") or "").lower().strip()
        if kind not in ("rite", "sanctum", "fragment"):
            return self.send_json(400, {"error": "invalid_kind"})

        client_id = str(data.get("clientId") or "anon")[:64]
        day_key = client_day_key(client_id)

        with LOCK:
            store = load_store()
            used = int(store.setdefault("belief_log", {}).get(day_key, 0))
            if used >= MAX_BELIEF_EVENTS_PER_DAY:
                world = world_snapshot(store)
                save_store(store)
                return self.send_json(429, {"error": "belief_capped", "world": world})

            # One sanctum thicken per client ever (soft)
            if kind == "sanctum":
                sk = f"sanctum:{client_id}"
                if store["belief_log"].get(sk):
                    world = world_snapshot(store)
                    save_store(store)
                    return self.send_json(200, {"world": world, "already": True})
                store["belief_log"][sk] = True

            # Fragment: at most 7 credited per client (soft)
            if kind == "fragment":
                fk = f"fragments:{client_id}"
                n = int(store["belief_log"].get(fk, 0))
                if n >= 7:
                    world = world_snapshot(store)
                    save_store(store)
                    return self.send_json(200, {"world": world, "already": True})
                store["belief_log"][fk] = n + 1

            store["belief_log"][day_key] = used + 1
            world = thicken(store, kind)
            save_store(store)

        return self.send_json(200, {"world": world})

    def handle_post_whisper(self, data: dict) -> None:
        message = sanitize_message(data.get("message", ""))
        if not message:
            return self.send_json(400, {"error": "empty_message"})

        try:
            fragments = int(data.get("fragments", 0))
        except (TypeError, ValueError):
            fragments = 0

        # Soft-gate: honor client fragment count (myth, not security theater)
        if fragments < MIN_FRAGMENTS_TO_POST:
            return self.send_json(403, {"error": "need_seven_fragments", "required": MIN_FRAGMENTS_TO_POST})

        username = sanitize_name(data.get("username"))
        client_id = str(data.get("clientId") or "anon")[:64]

        whisper = {
            "id": str(uuid.uuid4()),
            "username": username,
            "message": message,
            "amplifies": 0,
            "isCanon": False,
            "createdAt": utc_now(),
            "clientId": client_id,
        }

        with LOCK:
            store = load_store()
            store["whispers"].insert(0, whisper)
            store["whispers"] = store["whispers"][:MAX_WHISPERS]
            world = thicken(store, "whisper")
            save_store(store)

        return self.send_json(201, {"whisper": whisper, "world": world})

    def handle_amplify(self, whisper_id: str, data: dict) -> None:
        client_id = str(data.get("clientId") or "anon")[:64]
        day_key = client_day_key(client_id)

        with LOCK:
            store = load_store()
            used = int(store["amplify_log"].get(day_key, 0))
            if used >= DAILY_AMPLIFIES:
                return self.send_json(429, {"error": "no_amplifies_left", "left": 0})

            whisper = next((w for w in store["whispers"] if w.get("id") == whisper_id), None)
            if not whisper:
                return self.send_json(404, {"error": "whisper_not_found"})
            if whisper.get("isCanon"):
                return self.send_json(400, {"error": "already_canon"})

            # One amplify per client per whisper per day
            unique_key = f"{day_key}:{whisper_id}"
            if store["amplify_log"].get(unique_key):
                return self.send_json(400, {"error": "already_amplified"})

            canon_count = sum(1 for w in store["whispers"] if w.get("isCanon"))
            required = canon_required(canon_count)

            whisper["amplifies"] = int(whisper.get("amplifies", 0)) + 1
            became_canon = False
            if whisper["amplifies"] >= required:
                whisper["isCanon"] = True
                became_canon = True

            store["amplify_log"][day_key] = used + 1
            store["amplify_log"][unique_key] = True

            # prune old amplify log keys (keep ~14 days of day keys roughly by size)
            if len(store["amplify_log"]) > 5000:
                # drop half arbitrarily
                keys = list(store["amplify_log"].keys())
                for k in keys[: len(keys) // 2]:
                    store["amplify_log"].pop(k, None)

            world = thicken(store, "canon" if became_canon else "amplify")
            save_store(store)
            left = DAILY_AMPLIFIES - store["amplify_log"][day_key]

        return self.send_json(
            200,
            {
                "whisper": whisper,
                "becameCanon": became_canon,
                "amplifiesLeft": left,
                "required": required,
                "world": world,
            },
        )

    def handle_claim_saint(self, data: dict) -> None:
        name = sanitize_name(data.get("name")) or "Anonymous Degen"
        rank = str(data.get("rank") or "disciple").lower()
        if rank not in ("disciple", "saint", "believer"):
            rank = "disciple"

        try:
            fragments = int(data.get("fragments", 0))
        except (TypeError, ValueError):
            fragments = 0

        sanctum = bool(data.get("sanctum"))
        forbidden = bool(data.get("forbidden"))
        client_id = str(data.get("clientId") or "anon")[:64]

        def as_nonneg_int(val, cap=10_000_000):
            try:
                n = int(val)
            except (TypeError, ValueError):
                n = 0
            return max(0, min(n, cap))

        thickness = as_nonneg_int(data.get("thickness"), 50_000_000)
        streak = as_nonneg_int(data.get("streak"), 10_000)
        rites_completed = as_nonneg_int(data.get("ritesCompleted"), 10_000)

        if fragments < MIN_FRAGMENTS_TO_CLAIM or not sanctum:
            return self.send_json(
                403,
                {"error": "need_disciple", "detail": "Claim requires 7 fragments + sanctum completion"},
            )

        # Rank truth from proof flags (soft)
        if forbidden and sanctum:
            rank = "saint"
        elif sanctum:
            rank = "disciple"
        else:
            rank = "believer"

        claim = {
            "id": str(uuid.uuid4()),
            "name": name,
            "rank": rank,
            "fragments": fragments,
            "sanctum": sanctum,
            "forbidden": forbidden,
            "thickness": thickness,
            "streak": streak,
            "ritesCompleted": rites_completed,
            "claimedAt": utc_now(),
            "clientId": client_id,
        }

        with LOCK:
            store = load_store()
            # Upsert by clientId — one public identity per browser fingerprint id
            existing_idx = next(
                (i for i, s in enumerate(store["saints"]) if s.get("clientId") == client_id),
                None,
            )
            if existing_idx is not None:
                prev = store["saints"][existing_idx]
                claim["id"] = prev.get("id", claim["id"])
                claim["claimedAt"] = prev.get("claimedAt", claim["claimedAt"])
                claim["updatedAt"] = utc_now()
                # Keep best-known flex stats if client under-reports
                claim["thickness"] = max(thickness, int(prev.get("thickness") or 0))
                claim["streak"] = max(streak, int(prev.get("streak") or 0))
                claim["ritesCompleted"] = max(rites_completed, int(prev.get("ritesCompleted") or 0))
                store["saints"][existing_idx] = claim
                world = world_snapshot(store)  # update re-claim doesn't spam mass
            else:
                store["saints"].insert(0, claim)
                store["saints"] = store["saints"][:MAX_SAINTS]
                world = thicken(store, "claim")
            save_store(store)

        return self.send_json(201, {"saint": claim, "world": world})


def start_server(host: str, port: int) -> ThreadingHTTPServer:
    httpd = ThreadingHTTPServer((host, port), CultHandler)
    return httpd


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not STORE_PATH.exists():
        save_store(default_store())

    port = PORT
    server = None
    last_err = None
    # On hosted platforms PORT is assigned — don't scan other ports
    hosted = bool(os.environ.get("PORT") or os.environ.get("RENDER") or os.environ.get("RAILWAY_ENVIRONMENT"))
    candidates = [port] if hosted else list(range(port, port + 20))

    for candidate in candidates:
        try:
            server = start_server(HOST, candidate)
            port = candidate
            break
        except OSError as e:
            last_err = e
            # 48 = Address already in use (macOS), 98 = Linux EADDRINUSE
            if getattr(e, "errno", None) in (48, 98) and not hosted:
                continue
            if getattr(e, "errno", None) in (13, 1):
                print("Permission denied binding to port.")
                print("Use:  python3 server.py")
                raise SystemExit(1) from e
            if hosted:
                print(f"Failed to bind {HOST}:{candidate}: {e}")
                raise SystemExit(1) from e
            raise

    if server is None:
        print(f"Could not bind near port {PORT}: {last_err}")
        print(f"Try opening: http://127.0.0.1:{PORT}/newchonky.html")
        print("Or stop the old server:  kill $(lsof -t -i:8787)")
        raise SystemExit(1)

    print("Chonky cult server")
    print(f"   Bind:  {HOST}:{port}")
    print(f"   Local: http://127.0.0.1:{port}/")
    print(f"   Main:  http://127.0.0.1:{port}/newchonky.html")
    print(f"   API:   http://127.0.0.1:{port}/api/health")
    print(f"   Data:  {STORE_PATH}")
    if port != PORT and not hosted:
        print(f"   Note: preferred port was busy, using {port}")
    print("   Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()
