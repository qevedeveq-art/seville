#!/usr/bin/env python3
"""Veille des places — Puechoultres & Devesa à Séville.
Interroge (en lecture seule, comme un visiteur) les calendriers publics de réservation
et imprime un JSON : [{key, label, status: "dispo"|"complet", detail}].
Aucune réservation n'est effectuée."""
import json, re, sys, urllib.request, urllib.parse, datetime

UA = {"User-Agent": "Mozilla/5.0 (veille perso 4 pers.)", "Accept": "application/json"}
PEOPLE = 4

def http(url, data=None, headers=None, form=False):
    h = dict(UA); h.update(headers or {})
    body = None
    if data is not None:
        if form:
            body = urllib.parse.urlencode(data).encode(); h["Content-Type"] = "application/x-www-form-urlencoded"; h["X-Requested-With"] = "XMLHttpRequest"
        else:
            body = json.dumps(data).encode(); h["Content-Type"] = "application/json"
    with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=h), timeout=25) as r:
        return json.loads(r.read().decode())

def cathedral():
    base = "https://admin.catedraldesevilla.servitickets.es/api"
    tok = http(base + "/places/authenticate", {"api_key": "place_f2cFZ1FwwUhrVBRJK33EM4aj8xzDZkmMesdIosQx"})["token"]
    auth = {"Authorization": "Bearer " + tok}
    cal = http(f"{base}/visits/25/calendar?place_id=2&tour=25&month=10&year=2026", headers=auth)["data"]["daysWithItems"]
    out = []
    for day in cal:
        if day["date"] not in ("2026-10-01", "2026-10-02", "2026-10-03"): continue
        times = {str(t["id"]): t["start_date"][11:16] for t in day["timetables"]}
        occ = http(f"{base}/visits/25/calendar/day-occupation?place_id=2&tour=25&date={day['date']}", headers=auth)["data"]
        free = sorted((times[k], v.get("availables") or 0) for k, v in occ.items() if k in times and (v.get("availables") or 0) >= PEOPLE)
        am = [f"{h} ({n})" for h, n in free if h < "13:00"]
        lbl = {"2026-10-01": "jeu. 1", "2026-10-02": "ven. 2", "2026-10-03": "sam. 3"}[day["date"]]
        out.append({"key": f"cath_{day['date'][-1]}_matin", "label": f"Cathédrale {lbl} — matin (avant 13h)",
                    "status": "dispo" if am else "complet", "detail": ", ".join(am[:8]) or "aucun créneau pour 4"})
        if day["date"] == "2026-10-03":
            pm = [f"{h} ({n})" for h, n in free if "16:00" <= h <= "17:30"]
            out.append({"key": "cath_3_aprem", "label": "Cathédrale sam. 3 — 16h–17h30",
                        "status": "dispo" if pm else "complet", "detail": ", ".join(pm[:8]) or "aucun créneau pour 4"})
    return out

def covermanager(resto, date, key, label, slot_filter):
    d = http("https://www.covermanager.com/reservation/update_hours/0",
             {"language": "spanish", "restaurant": resto, "people": PEOPLE, "hour": "", "dia": date, "time_fix": "",
              "skip_blocked_tables": "false", "marketplace": "false"}, form=True)
    hours = [h for h in re.findall(r'<option[^>]*value="(\d{1,2}:\d{2})"', d.get("hour_box", "")) if slot_filter(h)]
    return {"key": key, "label": label, "status": "dispo" if hours else "complet", "detail": ", ".join(hours) or "aucun créneau pour 4"}

def main():
    if datetime.date.today() > datetime.date(2026, 10, 3):
        print("[]"); return
    res, errors = [], []
    for fn in (cathedral,
               lambda: [covermanager("restaurante-espacioeslava", "01-10-2026", "eslava_1_diner", "Eslava jeu. 1 — dîner (salle)", lambda h: h >= "20:00")],
               lambda: [covermanager("restaurante-sobretablas", "03-10-2026", "sobretablas_3_midi", "Sobretablas sam. 3 — déjeuner", lambda h: h < "17:00")]):
        try: res += fn()
        except Exception as e: errors.append(str(e)[:200])
    print(json.dumps(res, ensure_ascii=False))
    if errors: print("ERREURS: " + " | ".join(errors), file=sys.stderr)

if __name__ == "__main__":
    main()
