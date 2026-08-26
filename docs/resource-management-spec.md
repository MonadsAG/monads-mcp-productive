# Spezifikation: Resource-Management-MCP-Tools

Umsetzungsvorlage für die drei Tools **Abwesenheit anlegen**, **Abwesenheit
auslesen** und **Kapazitätsplanung** im Productive-MCP.

Alles hier Genannte ist entweder gegen die API verifiziert oder als fachliche
Vorgabe abgestimmt. Wo etwas nur angenommen ist, steht es in Abschnitt 11.

---

> ## Verbindliche Regel: keine Abwesenheitskategorien im Tool
>
> Event-Namen und Event-IDs dürfen **nirgends** im MCP hartkodiert werden —
> nicht im Code, nicht in Tool-Beschreibungen, nicht in Schemas, nicht als
> Default. Abwesenheitstypen werden zur Laufzeit per `GET /events` gelesen.
>
> Deshalb enthält diese Spezifikation bewusst **keine** Liste der real
> konfigurierten Abwesenheitstypen.
>
> Präzedenzfall im Repo: das hartkodierte `update_task_sprint`-Tool wurde aus
> demselben Grund durch einen generischen Mechanismus ersetzt (siehe
> `CLAUDE.md`).

---

## 1. Auth & Grundlagen

Quelle: `src/api/client.ts`.

- **Basis-URL:** `https://api.productive.io/api/v2/` (überschreibbar via
  `PRODUCTIVE_API_BASE_URL`)
- **Header bei jedem Request:**
  - `X-Auth-Token` — persönliches API-Token des aufrufenden Benutzers
  - `X-Organization-Id` — Organisations-ID
  - `Content-Type: application/vnd.api+json`
- **Format:** JSON:API — `data` / `attributes` / `relationships` / `included`
- **Ausnahme beim Schreiben von Bookings:** siehe Abschnitt 5

---

## 2. Datenmodell: Event / Booking / Time Entry

| Objekt | Was es ist |
|---|---|
| **Event** | Definition eines Abwesenheitstyps — eine Kategorie/Vorlage, kein Termin |
| **Booking** | Konkreter geplanter Eintrag im Ressourcenplan. Planung, nicht geleistete Zeit |
| **Time Entry** | Tatsächlich erfasste, geleistete Zeit (das, was die bestehenden Tools verwalten) |

Ein Time Entry kann unabhängig davon existieren, ob es vorher ein Booking gab.
Aus einem Booking entsteht **kein** Time Entry.

---

## 3. Abwesenheit vs. Kapazitätsplanung — die Kernunterscheidung

Beide sind Bookings. Der Unterschied liegt in der gesetzten Relationship:

| | Abwesenheits-Booking | Kapazitäts-Booking |
|---|---|---|
| gesetzte Relationship | `event_id` | `service_id` (bzw. `project_id` / `budget_id`) |
| die jeweils andere | `service`: `null` | `event`: leer |
| `stage_type` | `null` | `1` = Deal, `2` = Budget |

Beim Lesen zuverlässig unterscheiden: mit `?include=event,service` laden und
auswerten — `event.data != null` → Abwesenheit, `service.data != null` →
Kapazität. Es gibt keinen Filter, der das allein leistet.

---

## 4. Bookings — Feld-Mapping

Vollständige Gegenüberstellung. „Response" heisst: von der API gesetzt,
**nicht** selbst mitgeben.

| Feld | Abwesenheit | Projekt-Kapazität | Anmerkung |
|---|---|---|---|
| `person_id` | **Pflicht** | **Pflicht** | flaches Attribut, siehe Abschnitt 5 |
| `event_id` | **Pflicht** | — | zur Laufzeit aus `GET /events` |
| `service_id` | — | **Pflicht** | Projektleistung |
| `started_on` / `ended_on` | **Pflicht** | **Pflicht** | `YYYY-MM-DD` |
| `booking_method_id` | **Pflicht** | **Pflicht** | 1 / 2 / 3, siehe unten |
| `hours` + `time` | bei Methode 1 | bei Methode 1 | `time` in Minuten |
| `percentage` | bei Methode 2 | bei Methode 2 | 0–100 |
| `total_time` | bei Methode 3 | bei Methode 3 | Minuten |
| `note` | optional | optional | Freitext |
| `total_working_days` | Response | Response | API berechnet |
| `approved`, `approved_at` | Response | Response | **nie selbst setzen** |
| `rejected`, `rejected_at`, `rejected_reason` | Response | Response | |
| `canceled`, `canceled_at` | Response | Response | |
| `approval_statuses` | Response (Relationship) | Response | Status je Genehmiger |
| `stage_type` | `null` | 1 = Deal, 2 = Budget | nur bei Kapazitäts-Bookings |
| `draft` | nicht setzen | nicht setzen | Semantik unverifiziert, Abschnitt 11 |
| `people_custom_fields` | Response | Response | enthält Personendaten — nicht durchreichen |

**`booking_method_id`** bestimmt, welches Mengenfeld gefüllt wird:

| Wert | Bedeutung | zugehöriges Feld |
|---|---|---|
| 1 | Hours per day | `hours` + `time` |
| 2 | Percentage | `percentage` |
| 3 | Total hours | `total_time` |

> Beim **Schreiben** genügt das zur Methode passende Feld. Beim **Lesen** darf
> sich ein Tool nicht darauf verlassen, dass die anderen `null` sind — die API
> liefert teils mehrere Mengenfelder gleichzeitig zurück.

### Enums, die nur Filter sind — keine Response-Attribute

Beides existiert **nicht** als Feld auf dem Booking, nur als Query-Parameter:

| Parameter | Werte |
|---|---|
| `approval_status` | 1 = Approved, 2 = Pending, 3 = Rejected, 5 = Canceled |
| `person_type` | 1 = User, 2 = Contact, 3 = Placeholder, 4 = Agent |

Die Response liefert stattdessen `approved`, `approved_at`, `rejected`,
`rejected_at`, `rejected_reason`, `canceled`, `canceled_at` sowie die
Relationship `approval_statuses` („Per-approver approval status records for
this booking").

### Weitere nützliche Filter

`filter[after]`, `filter[before]`, `filter[person_id]`,
`filter[approval_status]`, `filter[with_draft]`, `filter[canceled]`,
`filter[person_type]`

---

## 5. `POST /bookings` — Payload-Format

**Wichtigster Stolperstein beim Bau von „Abwesenheit anlegen".**

`person_id`, `event_id` und `service_id` heissen in der Doku „Relationships",
müssen aber als **flache Attribute** gesendet werden. Das klassische
JSON:API-Relationship-Format schlägt mit `422 Invalid Attribute` fehl —
abweichend von der Konvention, die dieses Repo für `time_entries`
dokumentiert.

**Richtig:**

```json
{
  "data": {
    "type": "bookings",
    "attributes": {
      "person_id": 1234567,
      "event_id": 7654321,
      "started_on": "2026-09-01",
      "ended_on": "2026-09-05",
      "booking_method_id": 1,
      "hours": 8,
      "time": 480
    }
  }
}
```

**Falsch** (führt zu 422):

```json
{ "data": { "relationships": { "person": { "data": { "type": "people", "id": "1234567" } } } } }
```

`total_time` und `total_working_days` nicht mitgeben — die API berechnet sie.

**Zweite Falle:** Eine in Productive **deaktivierte Person** führt zum
**identischen** 422 mit demselben Pointer `data/attributes/person`. Die
Fehlermeldung unterscheidet nicht zwischen falschem Format und ungültiger
Person. Vor dem Anlegen prüfen, ob die Person aktiv ist (`deactivated_at`),
und eine verständliche Fehlermeldung ausgeben.

**Dritte Falle — Kontingent muss existieren:** Bei Abwesenheitstypen mit
begrenztem Kontingent (`limitation_type_id` 2 oder 3) verlangt die API, dass
die Person für genau diesen Typ ein Kontingent hinterlegt hat. Fehlt es:

```json
{ "errors": [ { "status": "422", "code": "entitlements_required",
  "detail": "has no allowance for this person",
  "source": { "pointer": "data/attributes/event" } } ] }
```

Bei Typen mit `limitation_type_id: 4` (unbegrenzt) tritt das nicht auf.

> **Für das Tool:** `entitlements_required` gezielt abfangen und verständlich
> melden („für diesen Abwesenheitstyp ist für diese Person kein Kontingent
> hinterlegt") statt den API-Fehler durchzureichen. Das Kontingent selbst wird
> vom Tool **nicht** verwaltet — das bleibt aus dem Scope (Abschnitt 10).

---

## 6. Genehmigung

### Prinzip

Genehmigungen laufen über Approval-Workflows. Im Workflow steht in
`dynamic_approver_ids` ein **Rollen-Token** — `"1"` bedeutet „Manager", also
„der Vorgesetzte der buchenden Person". Es ist **keine** Personen-ID. Die
offizielle Doku wörtlich:

> „Manager (id: 1) – The person's manager is automatically assigned as the
> approver or subscriber for the corresponding request."

**Konsequenz:** Das Tool gibt **keinen** Genehmiger mit. Productive löst das
serverseitig auf.

Relevante Felder auf `approval_workflows`:

| Feld | Bedeutung |
|---|---|
| `approval_requirement_id` | 1 = None, 2 = Any of the listed approvers, 3 = All listed approvers |
| `approver_ids` | explizite, literale Genehmiger |
| `dynamic_approver_ids` | Rollen-Tokens, zur Laufzeit aufgelöst (1 = Manager) |
| `target_type_id` | 1 = Event, 2 = Time, 3 = Expense |
| `event_id` | Abwesenheitskategorie, für die der Workflow gilt |

Zwei Ebenen gehören zusammen: `dynamic_approver_ids` legt fest, **wer**
genehmigen darf; die Relationship `approval_statuses` auf dem Booking hält
fest, **was** dieser Genehmiger bei einem konkreten Booking entschieden hat.

### Ob eine Genehmigung anfällt, hängt an der Person — nicht am Token

Ausschlaggebend ist, ob die **gebuchte Person eine Approval-Policy zugewiesen**
hat (Relationship `approval_policy_assignment` auf `GET /people/{id}`):

| Person hat `approval_policy_assignment` | Ergebnis beim Anlegen |
|---|---|
| **ja** | `approved: false`, `approval_statuses` enthält einen offenen Eintrag |
| **nein** | `approved: true` sofort, `approval_statuses` leer |

Praktisch verifiziert: identischer Token, identisches Event, zwei
verschiedene Personen → einmal Genehmigung ausgelöst, einmal nicht. Weder die
Rechte des aufrufenden Tokens noch ein gesetzter `manager` sind
ausschlaggebend — eine Person mit Manager, aber ohne Approval-Policy wird
sofort genehmigt.

**Beides kommt produktiv vor:** In der Monads-Organisation haben aktuell
**4 von 8 Personen** eine Approval-Policy zugewiesen.

> **Ein erfolgreich angelegtes Booking ist nicht gleichbedeutend mit
> „genehmigt" — und auch nicht zwingend genehmigungspflichtig.** Das Tool kann
> das Verhalten **nicht vorhersagen**. Es muss `approved` und
> `approval_statuses` aus der Response lesen und den tatsächlichen Status
> zurückmelden.

### Genehmigungspflicht nicht aus dem Event-Typ ableiten

Naheliegend wäre, sie aus `limitation_type_id` zu schliessen. Das ist
**falsch**: Gesetzliche Feiertage sind identisch konfiguriert wie Ferien
(`limitation_type_id: 2`), sind aber **nicht genehmigungspflichtig**. Das Feld
taugt nicht als Prädiktor.

Wird die Genehmigungspflicht gebraucht, kommt sie aus den Approval-Workflows
(`GET /approval_workflows`, `target_type_id: 1` = Event, verknüpft über
`event_id`) — also ebenfalls zur Laufzeit gelesen.

---

## 7. Sichtbarkeits-Grenze

Ein normales User-Token sieht **nur die eigene Ressourcenplanung**, nicht die
anderer Personen. Das ist gewolltes Verhalten von Productive.

**Für die Tools heisst das:**

- `GET /bookings` liefert mit einem normalen Token nur die eigenen Bookings.
  Ein leeres Ergebnis bedeutet **nicht** „es gibt keine".
- Das gehört in die Tool-Ausgabe, sonst meldet das Tool fälschlich „keine
  Abwesenheiten gefunden".
- Ein Tool, das fremde Bookings lesen oder genehmigen soll, funktioniert mit
  einem normalen Token nicht.

Der MCP-Server arbeitet produktiv mit **per-User-PATs** (BYOT, siehe
`CLAUDE.md`) — also genau mit solchen normalen Tokens.

---

## 8. Abwesenheitstypen zur Laufzeit lesen

`GET /events` liefert die konfigurierten Abwesenheitstypen. Auszuwertende
Felder:

| Feld | Bedeutung |
|---|---|
| `name` | Anzeigename — **nur durchreichen, nie im Tool prüfen oder mappen** |
| `absence_type` | z. B. `time_off` |
| `event_type_id` | 1 = Paid, 2 = Unpaid |
| `limitation_type_id` | 2 = Limited by days, 3 = Limited by hours, 4 = Unlimited by hours |
| `half_day_bookings` | Boolean — ob Halbtage buchbar sind |

**Wahl von `booking_method_id`** — für beide Fälle praktisch bestätigt:

| `half_day_bookings` | `booking_method_id` | mitzugeben |
|---|---|---|
| `true` | 1 = Hours per day | `hours` + `time` |
| `false` | 3 = Total hours | `total_time` |

Wenn das Tool die Methode selbst wählt, sollte sie trotzdem
**überschreibbar** bleiben — die Zuordnung ist eine sinnvolle Voreinstellung,
keine von der API erzwungene Regel.

*Randnotiz: Bei Methode 3 liefert die Response `time: 0` statt `null`.*

---

## 9. Kapazitätsplanung

**Priorisierung (fachlich abgestimmt):**

1. **Auslastung pro Person und Zeitraum** — wichtigste Auswertung. Gebuchte
   Kapazität (Bookings mit `service_id`) im Verhältnis zur Soll-Arbeitszeit,
   Zeitraum wählbar (Tag/Woche/Monat).
2. **Freie Kapazität** — Soll-Arbeitszeit minus gebuchte Projektkapazität
   minus geplante Abwesenheiten (Bookings mit `event_id`). Technisch fast
   dieselbe Rechnung wie 1.
3. **Überbuchungs-Erkennung** — Summe aller Bookings über der
   Soll-Arbeitszeit. Als **nachrangig** eingestuft: umsetzen, aber später.
   Warnliste, **keine** blockierende Validierung.

### Soll-Arbeitszeit: Feld `availabilities` auf der Person

`GET /people`, Feld `availabilities`. JSON-**String**, der ein Array von
Zeitscheiben enthält:

```
[[ "<gültig-ab>", <gültig-bis|null>, [14 Zahlen], <Kalender-ID> ]]
```

| Position | Inhalt |
|---|---|
| `[0]` | Gültig-ab-Datum |
| `[1]` | Gültig-bis-Datum, `null` = aktuell gültige Scheibe |
| `[2]` | 14 Zahlen = Stunden je Tag über einen **Zwei-Wochen-Rhythmus** |
| `[3]` | bei allen Personen identisch, vermutlich Kalender-ID — ignorieren |

**Zwei Fallstricke, die sonst falsche Zahlen erzeugen:**

- **Pensen sind unterschiedlich** — es kommen 16, 25, 32 und 40 Wochenstunden
  vor. Eine pauschale 40-Stunden-Woche wäre für die Mehrheit falsch.
  Wochen-Soll = Summe der 14 Werte ÷ 2.
- **Mehrere Zeitscheiben je Person** bilden die Historie von
  Pensum-Änderungen ab. Es muss die zum abgefragten Zeitraum passende gewählt
  werden — nicht die erste, nicht die letzte.

### Vor dem Bau zu entscheiden

> Ein **team-weiter** Kapazitätsüberblick funktioniert mit per-User-PATs
> prinzipiell nicht, weil jeder nur die eigene Planung sieht (Abschnitt 7).
> Drei gangbare Wege: (a) das Tool zeigt bewusst nur die eigene Auslastung,
> (b) es nutzt für diesen Zweck einen erhöhten Token, (c) es liefert nur für
> Berechtigte vollständige Ergebnisse. Fällt diese Entscheidung nicht vorher,
> entsteht ein Tool, das im Echtbetrieb leer bleibt.

---

## 10. Nicht im Scope

| Thema | Begründung |
|---|---|
| **Entitlements verwalten** | Fachlich ausgeschlossen — **aber:** die API erzwingt beim Anlegen ein vorhandenes Kontingent für begrenzte Abwesenheitstypen. Der Fehler `entitlements_required` muss abgefangen werden, siehe Abschnitt 5. Kontingente werden nicht vom Tool angelegt oder geändert |
| **`/placeholders`-Ressource** | Anderes Feature (Platzhalter für Task-/Todo-Felder), nicht Ressourcenplanung. In der echten Org ohnehin 403 und plan-gegated |
| **Placeholder-Personen als Anwendungsfall** | Produktiv werden keine angelegt. Der Mechanismus muss trotzdem sauber verarbeitet werden, siehe unten |
| **`resource_requests`** | Eigener Workflow, der Anfragen in Bookings auflöst — nicht Teil dieser Aufgabe |

**Zu Placeholder-Personen:** Es gibt Personen mit `placeholder: true`
(`filter[person_type]=3`) — Platzhalter-Ressourcen ohne Login, mit eigener
`availabilities`-Soll-Verfügbarkeit, regulär buchbar. In der Produktiv-Org
existieren keine, in anderen Umgebungen schon. Die Tools sollen sie **sauber
verarbeiten** (nicht abstürzen, `filter[person_type]` unterstützen), aber
nicht darauf ausgelegt werden.

---

## 11. Annahmen, die nicht praktisch belegt sind

Keine davon blockiert die Umsetzung. Aufgeführt, damit sie bei abweichendem
Verhalten schnell auffindbar sind.

| # | Annahme | Auswirkung |
|---|---|---|
| 1 | `draft`-Semantik je Booking-Typ unverifiziert — Empfehlung: nicht setzen | Lese-Tools |
| 2 | `stage_type` nur bei Kapazitäts-Bookings — aus zwei Datensätzen abgeleitet | Lese-Tools |
| 3 | Kein Schreibtest gegen die Produktiv-Org, nur gegen eine Sandbox | alles Schreibende |
| 4 | Ob eine Approval-Policy mehrstufige Genehmigung auslösen kann (mehrere `approval_statuses`), ist ungetestet — beobachtet wurde immer genau ein Eintrag | Statusanzeige im Tool |

**Praktisch verifiziert und damit keine Annahmen mehr:** der Genehmigungspfad
(Abschnitt 6, beide Varianten anhand echter Buchungen nachgestellt), die
Kontingent-Prüfung (Abschnitt 5) sowie die `booking_method_id`-Ableitung, die
inzwischen für beide Fälle bestätigt ist — `half_day_bookings: true` mit
Methode 1 und `false` mit Methode 3, jeweils erfolgreich angelegt.

---

## 12. Repo-Regeln beim Bau

- **Jedes neue Tool braucht einen Eintrag in `src/tools/toolsets.ts`** — sonst
  verschwindet es lautlos bei Deployments mit gesetztem `PRODUCTIVE_TOOLSETS`.
  `tests/unit/toolsets.test.ts` fängt das ab.
- **Kein stdout** — `console.error()` für Logging.
- **Neue Worker-only-Dateien** müssen in `tsconfig.json` unter `exclude`, sonst
  bricht der stdio-Build.
- **`people_custom_fields` nicht loggen und nicht ins Modell-Kontextfenster
  geben** — enthält personenbezogene Daten (u. a. Geburtsdatum,
  Bankverbindung).
