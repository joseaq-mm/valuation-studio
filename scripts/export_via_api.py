#!/usr/bin/env python3
"""Export YOUR Valuation Studio data via the public API (no Emergent terminal needed).

Works while the Emergent preview is still online and you can log in.

Steps:
  1. Open your Emergent app in Chrome and sign in with Google.
  2. DevTools (F12) → Application → Local Storage → your site → copy `vs:token`
     (If empty, try session cookie or log in again from the same tab.)
  3. Run:
       python scripts/export_via_api.py \\
         --url https://valuation-studio.preview.emergentagent.com \\
         --token 'PEGAR_TOKEN_AQUI' \\
         --out mongo-backup/user-export.json

  4. Import locally:
       cd backend && ./venv/bin/python ../scripts/import_user_backup.py \\
         --in ../mongo-backup/user-export.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent


def get(url: str, token: str, path: str, timeout: int = 120) -> dict:
    r = requests.get(
        f"{url.rstrip('/')}/api{path}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=timeout,
    )
    if r.status_code == 401:
        raise SystemExit("Token inválido o caducado. Vuelve a iniciar sesión y copia un vs:token nuevo.")
    r.raise_for_status()
    return r.json()


def main() -> int:
    p = argparse.ArgumentParser(description="Export user data from live Valuation Studio API")
    p.add_argument("--url", required=True, help="Emergent preview URL (sin /api)")
    p.add_argument("--token", required=True, help="vs:token from browser localStorage")
    p.add_argument("--out", default=str(ROOT / "mongo-backup" / "user-export.json"))
    p.add_argument("--download-files", action="store_true", help="Also download KPI PDFs (lento)")
    args = p.parse_args()

    base = args.url.rstrip("/")
    token = args.token.strip()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    print(f"→ Conectando a {base} ...")
    me = get(base, token, "/auth/me")
    print(f"  Usuario: {me.get('email')} ({me.get('user_id')})")

    backup = {
        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source_url": base,
        "user": me,
        "portfolio": get(base, token, "/auth/portfolio"),
        "watchlist": get(base, token, "/auth/watchlist"),
        "notify": get(base, token, "/auth/notify"),
        "folders": get(base, token, "/thesis/folders").get("folders", []),
        "alerts": get(base, token, "/thesis/alerts").get("alerts", {}),
        "theses": [],
        "kpi_extras": {},
    }

    items = get(base, token, "/thesis/list").get("items", [])
    print(f"  Tesis en lista: {len(items)}")

    for i, it in enumerate(items):
        tid = it["id"]
        print(f"  [{i+1}/{len(items)}] thesis {tid} ...")
        try:
            doc = get(base, token, f"/thesis/{tid}", timeout=180)
            backup["theses"].append(doc)
        except Exception as e:
            print(f"    WARN: no se pudo exportar {tid}: {e}")

        if it.get("type") == "company" or (it.get("title") or "").startswith("co_"):
            cid = tid
            extras = {}
            for path, key in [
                (f"/thesis/{cid}/kpis", "kpis"),
                (f"/thesis/{cid}/kpis/files", "files"),
                (f"/thesis/{cid}/kpis/news", "news"),
                (f"/thesis/{cid}/kpis/ir-sources", "ir_sources"),
            ]:
                try:
                    extras[key] = get(base, token, path, timeout=120)
                except Exception:
                    pass
            if extras:
                backup["kpi_extras"][cid] = extras

            if args.download_files:
                for f in (extras.get("files") or {}).get("files", []):
                    fid = f.get("id")
                    if not fid or not f.get("downloadable"):
                        continue
                    try:
                        r = requests.get(
                            f"{base}/api/thesis/{cid}/kpis/files/{fid}/download",
                            headers={"Authorization": f"Bearer {token}"},
                            timeout=180,
                        )
                        if r.ok:
                            import base64
                            f["_backup_b64"] = base64.b64encode(r.content).decode("ascii")
                            f["_backup_content_type"] = r.headers.get("content-type")
                    except Exception as e:
                        print(f"    WARN file {fid}: {e}")

    out.write_text(json.dumps(backup, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n✓ Exportado en {out}")
    print(f"  Tesis completas: {len(backup['theses'])}")
    print(f"  Importar: cd backend && ./venv/bin/python ../scripts/import_user_backup.py --in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
