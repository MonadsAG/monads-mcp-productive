# Journal: Fachanalyse Resource-Management-API

Arbeitsprotokoll zur Spezifikation in `resource-management-spec.md` — Belege,
Rohdaten, Fabians Antworten im Original, zurückgenommene Annahmen und
Prüfgrenzen.

**Wer die Tools baut, braucht dieses Dokument nicht.** Es existiert, damit
nachvollziehbar bleibt, woher jede Aussage der Spezifikation kommt und wie
belastbar sie ist.

Stand: 2026-08-26, fachlich abgeschlossen.

---

## 1. Zugriffslage — die Ursache der meisten offenen Punkte

Ein normales User-Token sieht nur die eigene Ressourcenplanung. Drei
unabhängige Belege:

1. **Telefonat mit Fabian** — bestätigtes, gewolltes Verhalten, kein Bug.
   Mündlich, nicht selbst API-seitig verifiziert.
2. **API-Diskrepanz echte Org vs. Sandbox** bei identischer Org-ID (43059):
   `approval_workflows` 0 vs. 60, `approval_policies` 403 vs. 34,
   `bookings` 0 vs. 197.
3. **UI-Personensuche (2026-08-19):** Namenssuche im Resourcing-Personenfilter
   nach einem bekannten Kollegen liefert unter „FILTERED" keinen Treffer. Die
   Einschränkung sitzt also schon auf Ebene der Personensuche, nicht erst bei
   den Booking-Details.

### Entscheidende Einordnung: der Sandbox-Zugang ist ein Admin-Key

Fabian im Gespräch am 2026-08-26: Der bisher genutzte Sandbox-Zugang ist
**sein Admin-API-Key**. Das ordnet die obigen Befunde neu ein:

- Beleg 2 misst nicht „echte Org vs. Sandbox als Umgebungen", sondern
  **normales User-Token vs. Admin-Token**. Der Rechte-Scope-Unterschied ist
  damit erklärt, nicht nur beobachtet.
- **Alle Sandbox-Rohdaten in diesem Journal sind Admin-Sicht** — 197 Bookings,
  60 Workflows, 34 Policies, 3 Placeholder-Personen. Ein normaler Benutzer
  sieht davon deutlich weniger.
- Der MCP-Server arbeitet produktiv mit **per-User-PATs** (BYOT). Gegen die
  Admin-Sandbox zu entwickeln testet also nicht den Produktivfall.

**Einschränkung zu Beleg 3:** Das ist **kein** Abgleich über die im Task
geforderte „Resource Planning / Bookings-Konfiguration"-Admin-Ansicht. Es
belegt denselben Effekt zusätzlich visuell, aus einem einzelnen,
nicht-administrativen Blickwinkel. Die tatsächliche Bookings- und
Approval-Konfiguration der echten Org wurde **nie eingesehen**. Diese
Task-Abhängigkeit wurde am 2026-08-26 bewusst zurückgestellt, da alle
fachlichen Fragen anderweitig beantwortet sind.

---

## 2. Fabians Antworten im Original

Zitate unverändert, inklusive Tippfehler.

### Runde 1 (2026-08-20)

| # | Ursprüngliche Frage | Antwort | Status |
|---|---|---|---|
| 1 | Bookings = 0 — bestehender oder neu einzuführender Prozess? | *„Bookings müsste es in der Sandbox geben. Du kannst aber auch einfach mal direkt über die API welche anlegen. Oder Bookings anlegen über den MCP, wenn der soweit ist."* | Erledigt über Live-Test, Abschnitt 5. Die ursprüngliche Frage (bestehender vs. neuer Prozess) blieb dabei unbeantwortet |
| 2 | Sind Placeholders relevant? | *„Placeholder sind relevant und müssten im System auch vorhanden sein."* | Geklärt, siehe Abschnitt 7 — bezog sich auf Placeholder-**Personen** |
| 3 | Wer genehmigt fachlich? | *„Genemigungen erfolgen in Producitve über den 'Manager'. Brauchst du den Genehmiger in der API? Wird das nicht automtaisch gemacht?"* | Geklärt, siehe unten und Abschnitt 8 |
| 4 | Ablageort der Fachanalyse | Kommentar am Productive-Task | Geklärt. **Confluence existiert bei Monads nicht** — die Erwähnung im Task war ein Fehler des Task-Erstellers, kein Zielkonflikt |
| 5 | Nur 2 von 8 Personen mit Entitlement | *„Entitlements ignorieren."* | Out of Scope |
| 6 | „Militär" fehlt als Event | *„Militär ignorieren. Die Kategorien sollten nirgendwo in einem MCP dokumentiert sein."* | Zwei Teile: „Militär" ist irrelevant **und** es gilt ein verbindlicher Architektur-Grundsatz — kein Hartkodieren von Kategorien. Das ist **nicht** dasselbe wie „Out of Scope" |

Antwort auf Fabians Rückfrage in #3, belegt über
`developer.productive.io/approval_workflows.html`: Ja, das läuft automatisch —
**wenn** der Workflow mit dem Rollen-Token „Manager" konfiguriert ist.
Wörtlich: *„Manager (id: 1) – The person's manager is automatically assigned
as the approver or subscriber for the corresponding request."*

### Runde 2 (Gespräch 2026-08-26)

| Thema | Antwort | Wirkung |
|---|---|---|
| Genehmigung | Eine Abwesenheit eines normalen Mitarbeiters **braucht seine Genehmigung**; unser Test lief nur durch, weil es sein Admin-Key war | Erste Hälfte trifft zu, die Begründung **nicht**: der A/B-Test in Abschnitt 5a zeigt, dass die `approval_policy_assignment` der Person entscheidet, nicht der Token |
| Soll-Arbeitszeit | Steht auf der Person, per API abfragbar | Konkretisiert zum Feld `availabilities`, Abschnitt 6a |
| Kapazitäts-Auswertungen | **Auslastung pro Person und Zeitraum** priorisiert; **Überbuchungs-Warnungen weniger relevant** | Reihenfolge der Umsetzung |
| Feiertage | **Nicht genehmigungspflichtig** | Widerlegt die Heuristik in Abschnitt 6 |
| Placeholder-Personen | Produktiv **keine anlegen** | Abschnitt 7 |
| Zugriffsrechte | Prüft er; separate Sandbox-Zugänge zugesagt | Ausstehend |

---

## 3. Bookings-Befund echte Org

`GET /bookings` liefert `total_count: 0`. Geprüft mit vier
Filterkombinationen, um ein Filterartefakt auszuschliessen: ohne Filter
(`page[size]=25`), `filter[with_draft]=true`, `filter[canceled]=true`,
`filter[after]=2020-01-01`. Alle vier: 0.

Alle vier sind reine Datums-/Status-Filter — keiner würde eine eingebaute
Personen-Scope-Beschränkung umgehen.

**Was der Befund aussagt:** dass der aufrufende Token persönlich keine
Bookings hat. **Nicht**, dass es org-weit keine gibt. Ob Bookings bei Monads
„noch nie genutzt" wurden oder ob Ressourcenplanung hier neu eingeführt
werden soll, lässt sich aus diesem Zugriff in keine Richtung ableiten. Bleibt
ausdrücklich offen statt interpretiert.

---

## 4. Sandbox-Rohdaten (2026-08-19)

> Erhoben mit **Admin-Key** (siehe Abschnitt 1). Struktur belegt, Mengen nicht
> repräsentativ für die Sicht eines normalen Benutzers.

`GET /bookings` → `total_count: 197`. Filtervarianten: ohne Filter 197,
`with_draft=true` 197, `canceled=true` 6, `after=2020-01-01` 197.

### Projekt-Booking, vollständige Feldstruktur (id 17674294)

```json
{
  "id": "17674294",
  "type": "bookings",
  "attributes": {
    "hours": null, "time": 480,
    "started_on": "2025-02-03", "ended_on": "2025-02-07",
    "note": "", "total_time": 1500, "total_working_days": 5, "percentage": 100,
    "created_at": "2025-01-23T16:55:42.994+01:00",
    "updated_at": "2025-03-07T03:13:13.710+01:00",
    "people_custom_fields": { "93130": "280182", "93131": "2025-01-01" },
    "approved": true, "approved_at": "2025-01-23T16:55:42.994+01:00",
    "rejected": false, "rejected_reason": null, "rejected_at": null,
    "canceled": false, "canceled_at": null,
    "booking_method_id": 2, "autotracking": false, "draft": false,
    "custom_fields": null, "external_id": null,
    "last_activity_at": "2025-02-14T09:43:15.000+01:00",
    "stage_type": 2
  },
  "relationships": {
    "organization": { "data": { "type": "organizations", "id": "43059" } },
    "service": { "meta": { "included": false } },
    "event": { "meta": { "included": false } },
    "person": { "meta": { "included": false } },
    "creator": { "meta": { "included": false } },
    "updater": { "meta": { "included": false } },
    "approver": { "meta": { "included": false } },
    "rejecter": { "meta": { "included": false } },
    "canceler": { "meta": { "included": false } },
    "origin": { "meta": { "included": false } },
    "approval_statuses": { "meta": { "included": false } },
    "custom_field_people": { "meta": { "included": false } },
    "custom_field_attachments": { "meta": { "included": false } },
    "attachments": { "meta": { "included": false } }
  }
}
```

### Abwesenheits-Booking zum Vergleich (id 18605683)

```json
{
  "id": "18605683",
  "attributes": {
    "hours": null, "time": null,
    "started_on": "2025-02-25", "ended_on": "2025-02-28",
    "total_time": 1920, "total_working_days": 4, "percentage": 100,
    "approved": true, "approved_at": "2025-02-17T23:24:13.105+01:00",
    "rejected": false, "canceled": false,
    "booking_method_id": 2, "draft": false, "stage_type": null
  },
  "relationships": {
    "service": { "data": null },
    "event": { "data": { "type": "events", "id": "133714" } }
  }
}
```

`event.data.id: "133714"` verweist auf dasselbe Event „Vacation", das auch in
der echten Org unter derselben ID existiert — ein Hinweis, dass Events
zwischen Sandbox und echter Org übereinstimmen können, auch wenn
Bookings/Approval-Daten es nicht tun. An einem Beispiel beobachtet, nicht
verallgemeinert.

**Beide Beispiele stammen aus der Sandbox, nicht aus der echten Monads-Org.**
Die technische Struktur ist damit belegt, aber nicht gegen echte Monads-Daten
verifiziert. Das gilt auch für die Gegenüberstellung Abwesenheit vs.
Kapazität in der Spezifikation.

---

## 5. Live-Test: eigenes Booking angelegt (2026-08-20, Sandbox)

Auf Fabians Vorschlag hin per `POST /bookings` angelegt: id `33731159`,
Vacation, 1 Tag, 8 h, Person = eigener Testaccount des Autors (ID pseudonymisiert).

**Befund 1 — Payload-Format.** Erster Versuch mit JSON:API-Relationship-Format
schlug mit `422 Invalid Attribute` fehl. `person_id`/`event_id` müssen flache
Attribute sein. Details und Beispielcode in der Spezifikation.

**Befund 2 — irreführende Fehlermeldung.** Die erste getestete Person
(id 1218747) war in der Sandbox deaktiviert (`deactivated_at` gesetzt) und
führte zum **identischen** 422 mit demselben Pointer
`data/attributes/person`. Mit einer aktiven Person funktionierte es sofort.

**Befund 3 — Heuristik bestätigt, für einen Fall.** Für Vacation
(`half_day_bookings: true`) war `booking_method_id: 1` als Vermutung
dokumentiert. Mit `hours: 8, time: 480` berechnete die API korrekt
`total_time: 480` und `total_working_days: 1`, `percentage` blieb `null`. Die
Vermutung war für diesen konkreten Fall richtig — für die übrigen Event-Typen
ungetestet.

**Befund 4 — Genehmigung wurde nicht ausgelöst.** Die Buchung war sofort
`approved: true`, `approval_statuses` komplett leer (`"data": []`).

Fabian erklärte das zunächst mit seinem Admin-Key. **Diese Erklärung hat sich
im Nachtest als falsch erwiesen** — siehe Abschnitt 5a: derselbe Token
erzeugte je nach gebuchter Person beide Verhaltensweisen. Ausschlaggebend ist
die `approval_policy_assignment` der Person. Die gebuchte Person dieses Tests
(eigener Testaccount) hat keine — deshalb sofort genehmigt.

Von den drei ursprünglich notierten Hypothesen kam damit keine exakt zu,
Hypothese 2 („liegt an der Konfiguration der Testperson") zielte aber in die
richtige Richtung; der Mechanismus ist die Approval-Policy, nicht der
Manager.

**Datenschutz-Nebenbefund:** `people_custom_fields` wurde automatisch mit
einer 1:1-Kopie der Custom-Field-Werte der gebuchten Person befüllt —
Geburtsdatum, Geschlecht, ein bankkontoähnliches Feld. Die Sandbox enthält
damit echte personenbezogene Daten, keine anonymisierten Testdaten. Werte
hier bewusst nicht wiedergegeben. Für die Tool-Implementierung relevant: das
Feld nicht unbesehen in Ausgaben durchreichen.

**Kein Schreibtest gegen die echte Org.** Schreibender Eingriff in
Produktivdaten, nur mit ausdrücklicher Freigabe.

---

## 6. Events der echten Org (2026-08-18)

> **Nicht als Vorlage zum Hartkodieren verwenden.** Momentaufnahme zur
> Veranschaulichung des Datenmodells. Laut Fabian dürfen diese Namen und IDs
> nirgends im MCP-Tool auftauchen — die Tools lesen Event-Typen zur Laufzeit
> per `GET /events`.

| id | name | absence_type | event_type_id | limitation_type_id | half_day_bookings |
|---|---|---|---|---|---|
| 136901 | Not available | time_off | 2 | 4 | false |
| 144638 | Paid Special Leave | time_off | 1 | 4 | false |
| 136900 | Public holidays | time_off | 1 | 2 | false |
| 139787 | Sick Leave | time_off | 1 | 4 | false |
| 144637 | Unpaid leave | time_off | 2 | 4 | true |
| 133714 | Vacation | time_off | 1 | 2 | true |

Alle sechs mit `relationships.organization.id: 43059`.

Beschreibungen (aus der API, gekürzt): *Not available* — externe/freiberufliche
Ressourcen, temporär nicht verfügbar. *Paid Special Leave* — bezahlter
Sonderurlaub (Heirat, Geburt, Umzug, Todesfall), Dauer nach Schweizer OR oder
internen Richtlinien. *Public holidays* — gesetzliche Feiertage nach
regionalem Kalender. *Sick Leave* — Krankheit/Unfall, ggf. Arztzeugnis.
*Unpaid leave* — genehmigte unbezahlte Abwesenheit, Freigabe durch
Vorgesetzten. *Vacation* — muss vorab beantragt und genehmigt werden, zieht
vom Ferienguthaben ab.

**Quelle:** `GET /events` ungefiltert; id 133714 zusätzlich per
`filter[id]` gegengeprüft; volle Liste erneut abgerufen zur Bestätigung von
`relationships.organization` für alle sechs. Kein Wert erfunden oder von
einem anderen Datensatz übertragen. Die deutschen Zusammenfassungen oben sind
eigene Paraphrasen, keine wörtlichen Zitate.

**Heuristik-Schwäche — bestätigt und aufgelöst (2026-08-26):** „Public
holidays" fällt unter `limitation_type_id: 2` wie „Vacation", woraus eine
Genehmigungspflicht abgeleitet würde. Fabian bestätigt: **Feiertage sind
nicht genehmigungspflichtig.** Die Ableitung aus der Feldsemantik lag also
nachweislich falsch. `limitation_type_id` taugt nicht als Prädiktor; die
Genehmigungspflicht ist aus den Approval-Workflows zu lesen (Abschnitt 8).

---

## 5a. Genehmigungstest mit dem zweiten Sandbox-Zugang (2026-08-26)

Mit dem neu bereitgestellten Sandbox-Token nachgestellt. **Ergebnis widerlegt
die bis dahin gültige Erklärung** („sofort genehmigt, weil Admin-Key").

**Vorbemerkungen zum Zugang:** Der zuvor genutzte Sandbox-Token liefert
inzwischen `401 invalid_auth_token` — er wurde ersetzt, nicht ergänzt. Der
Sandbox-Datenbestand hat sich ebenfalls geändert (Bookings 197 → 63,
Approval-Workflows 60 → 34, Policies 34 → 10, Personen 19). Die Rohdaten in
Abschnitt 4 stammen aus dem alten Stand. Der neue Token gehört laut
`creator`-Relationship eines angelegten Bookings ebenfalls **Fabian Diehl**
(`role_id: 1`) — also erneut kein normaler Benutzer-Zugang.

**A/B/C/D-Test, identischer Token, vier Kombinationen:**

| Test | Person | Event | `approved` | `approval_statuses` |
|---|---|---|---|---|
| A | eigener Testaccount | 133714 (limitation 2) | `true` | 0 |
| B | Max Muster (897026) | 139787 (limitation 4) | **`false`** | **1** |
| C | Andreas (1409426) | 139787 (limitation 4) | `true` | 0 |
| D | Fabian (890553) | 133714 (limitation 2) | `true` | 0 |

B und C unterscheiden sich **nur in der Person**, bei gleichem Event und
gleichem Token — die Genehmigung hängt also weder am Token noch am Event.

**Ursache, per `?include=manager,approval_policy_assignment` bestimmt:**

| Person | `manager` | `approval_policy_assignment` | Ergebnis |
|---|---|---|---|
| Max Muster | — | **28638** | Genehmigung ausgelöst |
| Andreas | Fabian | — | sofort genehmigt |
| eigener Testaccount | Fabian | — | sofort genehmigt |
| Fabian | — | — | sofort genehmigt |

**Ausschlaggebend ist die `approval_policy_assignment` auf der Person.** Ein
gesetzter `manager` allein genügt nicht: Andreas und Igor haben einen
Manager, werden aber sofort genehmigt.

Der ausgelöste `approval_status` (id 21547795) war offen:
`approved_at: null`, `rejected_at: null`, `target_type: "booking"`,
`approver_group_key: "group-0-0-…"`. Die `approver`-Relationship des Bookings
blieb dabei `null`.

**Echte Org (2026-08-26 geprüft):** 4 von 8 Personen haben eine
`approval_policy_assignment`, 6 von 8 einen `manager`. Beide Verhaltensweisen
kommen produktiv also vor. Ein Tool kann den Ausgang nicht vorhersagen.

**Alle fünf Test-Bookings wurden nach der Auswertung wieder gelöscht**
(`DELETE /bookings/{id}`, je 204).

---

## 5b. Kontingent-Pflicht beim Anlegen (2026-08-26)

Beim ersten Versuch für Person 897026 mit Event 133714
(`limitation_type_id: 2`) antwortete die API:

```json
{ "errors": [ { "status": "422", "code": "entitlements_required",
  "title": "Invalid Attribute", "detail": "has no allowance for this person",
  "source": { "pointer": "data/attributes/event" } } ] }
```

Mit einem Event mit `limitation_type_id: 4` (unbegrenzt) trat der Fehler
nicht auf. **Entitlements sind damit technisch nicht ignorierbar**, auch wenn
sie fachlich aus dem Scope genommen wurden: Für begrenzte Abwesenheitstypen
verlangt die API ein hinterlegtes Kontingent der jeweiligen Person.

Die Sandbox enthält dazu 17 Entitlements, ausschliesslich für die beiden
Events mit `limitation_type_id: 2` — kein einziges für einen unbegrenzten
Typ. Das stützt die Regel. Beispielwerte: `allocated` zwischen 2.0 und 49.0,
mit `used`/`pending` je Person und Event.

**Nebenbefund zur Heuristik:** Das erfolgreiche Booking nutzte
`booking_method_id: 3` bei `half_day_bookings: false` — damit ist die
Ableitung aus Abschnitt 6 nun für **beide** Fälle bestätigt, nicht nur für
einen. Die Response lieferte `total_time: 960`, `total_working_days: 2`,
`percentage: null`, `hours: null` und `time: 0` (nicht `null`).

---

## 6a. Soll-Arbeitszeit: Feld `availabilities` (2026-08-26)

Fabians Auskunft („steht auf der Person, über die API abfragbar") liess sich
konkret zuordnen: Feld `availabilities` auf `GET /people`, bei **allen 8
Personen** der echten Org gesetzt. Anonymisiert ausgewertet, keine
Personenzuordnung erhoben.

JSON-**String**, der ein Array von Zeitscheiben enthält:

```
[[ "<gültig-ab>", <gültig-bis|null>, [14 Zahlen], 44853 ]]
```

| Position | Inhalt | Beobachtung |
|---|---|---|
| `[0]` | Gültig-ab-Datum | immer gesetzt |
| `[1]` | Gültig-bis-Datum | `null` = aktuell gültige Scheibe |
| `[2]` | 14 Zahlen | Stunden je Tag über einen Zwei-Wochen-Rhythmus (Mo–So, Mo–So) |
| `[3]` | `44853` | bei allen Personen identisch, vermutlich org-weite Kalender-ID, nicht verifiziert |

**Vorkommende Wochenpensen** (Summe der 14 Werte ÷ 2, ohne
Personenzuordnung): 16, 25, 32 und 40 Stunden. Eine pauschale
40-Stunden-Annahme wäre für die Mehrheit falsch.

**Mehrere Zeitscheiben pro Person** bilden die Historie von
Pensum-Änderungen ab. Für eine Auslastungsrechnung muss die zum abgefragten
Zeitraum passende Scheibe gewählt werden.

Auch Placeholder-Personen haben `availabilities` — im Sandbox-Beispiel 8 h
Mo–Fr.

---

## 7. Placeholders — zwei verschiedene Konzepte

**Der zentrale Irrtum dieser Analyse, aufgelöst am 2026-08-21.** Bis dahin
galt: „Placeholders sind technisch blockiert (403), Ursache Plan-Gating oder
fehlende Berechtigung." Das stimmte nur für eine von zwei gleichnamigen
Ressourcen — gesucht wurde die falsche.

| | **Konzept A: Placeholder-Person** | **Konzept B: `/placeholders`** |
|---|---|---|
| Zweck | Platzhalter-Ressource für Kapazitätsplanung | Platzhalter für Task-/Todo-Felder |
| Zugriff | `GET /people?filter[person_type]=3`, Attribut `placeholder: true` | `GET /placeholders` |
| Unser Token | **funktioniert**, 200 OK | 403 in echter Org |
| Sandbox | **3 Datensätze** | 0 Datensätze |
| Echte Org | **0 Datensätze**, Status 200 | 403 |
| Relevanz | das meint Fabian | anderes Feature, out of scope |

### Konzept A — Befunde

Sandbox: drei Placeholder-Personen — `892540` „Berater", `892541`
„Entwickler", `890687` „Projektleiter". Merkmale (Beispiel 892540):
`placeholder: true`, `is_user: false`, `email: null`, `user_id: null`,
`role_id: null`, Rollenname im Feld `first_name`, `color_id` gesetzt,
`availabilities` gesetzt (8 h Mo–Fr).

**Buchbar — belegt:** `GET /bookings?filter[person_type]=3` → `total_count: 1`.
Booking `33731134` auf `890687`, Service `15926242` („Projektorganisation"),
2026-08-17 bis 2026-10-11, `total_working_days: 40`, `total_time: 19200`
(= 320 h), `percentage: 100`, `booking_method_id: 2`, `stage_type: 2`,
`event: null` — ein Projekt-Kapazitäts-Booking.

Echte Org: `GET /people?filter[person_type]=3` → `total_count: 0`, Status 200.
Das ist ein belastbares „es gibt keine", kein durch 403 verdecktes „wir sehen
nichts" — derselbe Endpunkt zeigt uns alle 8 Personen der Org. Zusätzlich
einzeln geprüft: keine der 8 hat `placeholder: true`.

**Entscheidung Fabian (2026-08-26):** Produktiv werden **keine**
Placeholder-Personen angelegt. Kein Widerspruch zu seiner Aussage vom 20.08.
(„müssten im System auch vorhanden sein") — dort ging er davon aus, dass
bereits welche existieren.

### Konzept B — Befunde

- Echte Org: `GET /placeholders` und `GET /placeholder_usages` → **403**
  (`"code": "access_denied"`), im Nachtest am 2026-08-20 unverändert.
- Sandbox: `GET /placeholders` → 200 OK, 0 Datensätze — auch mit
  `filter[type]=person` und `filter[category]=project` jeweils 0.
- Sandbox: `GET /placeholder_usages` → 403 mit *„Relative people and dates
  feature is not enabled"* — ein Feature-Flag, kein generisches Rechte-403.

**Zwei unabhängige belegte Ursachen** für die 403, nicht unterscheidbar:

1. **Plan-Gating** (`help.productive.io/en/articles/4168381-placeholders`):
   Essential „Not included", Professional „Up to 5 placeholders", Ultimate
   „Up to 10 placeholders".
2. **Granulare Berechtigung** (`help.productive.io/en/articles/12001310`):
   eigenes Recht *„View, add, edit, and delete placeholders" — „Full control
   over placeholder resources for planning."*

Ob sich die Plan-Limits auf Konzept A oder B beziehen, ist nicht
zweifelsfrei — der Help-Center-Artikel unterscheidet die Begriffe nicht so
scharf wie diese Analyse. Da Konzept A in der Sandbox ohne 403 funktioniert,
betreffen die 403-Befunde jedenfalls nur Konzept B.

### Attribut-Referenz Konzept B (Doku, ungeprüft gegen echte Daten)

`placeholders`: `id`, `name`, `type` (`person` | `date`), `category`
(`project`), `color`, `icon`, `created_at`, `updated_at`, `project_id`
(null = organisationsweit). Relationships: `organization`, `project`.

`placeholder_usages`: `field` (`assignee` | `subscriber` | `due_date` |
`start_date`), `placeholder_id`, `target_id`, `target_type` (task | todo),
`interval_enabled`, `interval_value`, `interval_unit` (`day` | `week` |
`month` | `year`), `interval_direction` (`before` | `after`),
`skip_weekends`. Relationships: `placeholder`, `task`, `todo`.

---

## 8. Approval-Workflows und -Policies

**Sandbox:** `GET /approval_workflows` → 200 OK, **60** Datensätze.
`GET /approval_policies` → 200 OK, **34** Datensätze — an genau der Stelle, an
der die echte Org 403 lieferte.

Beispiel-Workflow (id 146090): `approval_requirement_id: 2` (Any of the listed
approvers), `target_type_id: 1` (Event, also ein Abwesenheits-Workflow),
`dynamic_approver_ids: ["1"]` (Manager), `dynamic_subscriber_ids: []`.
`approver_ids`/`subscriber_ids` wurden im ursprünglichen Abgriff nicht separat
erfasst — vermutlich leer, nicht eigenständig verifiziert.

Beispiel-Policy (id 33499): `custom: true`, `default: false`, `type_id: 1`,
`name: null`, `description: null`. Bedeutung von `type_id` aus der Response
nicht ablesbar.

**Echte Org:** `approval_workflows` → 0 Ergebnisse. `approval_policies` → 403.

**Attribut-Referenz `approval_workflows`** (Doku):

| Feld | Bedeutung |
|---|---|
| `approval_requirement_id` | 1 = None, 2 = Any of the listed approvers, 3 = All listed approvers |
| `approver_ids` / `approvers` | explizite, literale Genehmiger |
| `dynamic_approver_ids` | Rollen-Tokens, zur Laufzeit aufgelöst (1 = Manager) |
| `subscriber_ids` / `dynamic_subscriber_ids` | analog, für Benachrichtigungen |
| `target_type_id` | 1 = Event, 2 = Time, 3 = Expense |
| `event_id` / `event` | Abwesenheitskategorie, für die der Workflow gilt |

**Verbleibende konfiguratorische Lücke:** Ob die echte Monads-Org denselben
`dynamic_approver_ids: ["1"]`-Mechanismus nutzt wie die Sandbox oder
stattdessen explizite `approver_ids`, ist nur über Admin-Zugriff oder einen
Schreibtest gegen die echte Org prüfbar.

**Wortlaut-Unschärfe:** Bei `approval_requirement_id: 3` liefern zwei
Doku-Abrufe leicht abweichende Formulierungen („All of" / „All listed
approvers"). Bedeutung identisch, exakter Wortlaut nicht zweifelsfrei.

---

## 9. Entitlements — Out of Scope, Befund archiviert

Fabian: *„Entitlements ignorieren."* Für die drei Folge-Tools nicht relevant.
Der Befund bleibt hier stehen, falls das je wieder aufgegriffen wird.

`GET /entitlements` → `total_count: 2`:

| id | start_date | end_date | allocated | used | pending | note |
|---|---|---|---|---|---|---|
| 289245 | 2026-08-17 | 2026-12-31 | 11.5 | 0.0 | 0.0 | (leer) |
| 289246 | 2026-08-17 | 2026-12-31 | 2.0 | 0.0 | 0.0 | (leer) |

Zwei Datensätze bei 8 Personen in der Org — war ursprünglich Frage 5 an
Fabian, durch „ignorieren" nicht mehr offen.

**Relationships nur als Stubs:** `event`, `person` und `approval_workflow`
jeweils nur `{ "meta": { "included": false } }`. Ohne `?include=` liefert die
API keine ID, sondern nur die Aussage, dass eine Verknüpfung existiert.

**Attribut-Referenz** (Doku, `reference/resources/entitlements`): `id`,
`allocated` („Total hours allocated to this person for the absence category in
the entitlement period"), `used` („approved absence bookings that have been
taken"), `pending` („submitted but not yet approved"), `date`, `start_date`,
`end_date`, `note`, `person_id`, `event_id`. Relationships: `person`, `event`,
`approval_workflow`, `organization`.

**Unsicherheit:** Ob die Doku überhaupt eine explizite „Required"-Markierung
enthält, ist unklar — ein Abruf fand sie, ein zweiter gezielterer fand auf
derselben Seite nur Kontext-Tags (Response/Request). Die Pflicht-Angaben zu
`person_id`/`event_id` sind daher **nicht** zweifelsfrei als wörtliches
Doku-Zitat zu werten. Wegen Out of Scope nicht weiterverfolgt.

---

## 10. Custom Fields

`GET /custom_fields` → 9 Custom Fields in der Organisation. Davon **0** mit
erkennbarem Bezug zu Bookings oder Events — geprüft per Volltextsuche über die
komplette JSON-Struktur jedes einzelnen Datensatzes nach „booking" und
„event", keine Treffer.

Damit ist die im Task genannte Prüfung „`list_custom_fields`/Bookings-Types
prüfen" erledigt: es gibt keine instanzspezifische Custom-Field-Konfiguration,
die in das Mapping einfliessen müsste.

---

## 11. `resource_requests` — Fund, bewusst nicht vertieft

Nicht im Original-Task genannt (der spricht nur von bookings, placeholders,
placeholder_usages, entitlements). Bei der Placeholder-Recherche sichtbar
geworden. Quelle: `developer.productive.io/reference/resources/resource-requests`.

Ein eigener Workflow für Ressourcen-**Anfragen** (nicht Bookings) mit eigenem
Status-Enum: `pending`, `resolved`, `rejected`, `canceled`. Attribute
überschneiden sich stark mit Bookings (`started_on`/`ended_on`,
`time`/`total_time`/`percentage`, `booking_method_id`), zusätzlich
Kosten-Felder (`max_cost_per_hour`, `currency`, `exchange_rate`) und
Klassifizierung (`job_title`, `team_id`, `service_type_id`).

**Der potenziell relevante Teil:** `POST /resource_requests/{id}/resolve` —
laut Doku *„Resolve a resource request by creating bookings"*. Es gibt also
einen expliziten Mechanismus, der eine Anfrage in echte Bookings umwandelt.
Das könnte der fehlende Link zwischen „jemand braucht eine Ressource" und
„jemand ist tatsächlich eingeplant" sein.

**Nicht vertieft, weil:** nicht im Task-Scope, und die Relevanz hängt daran,
ob mit Placeholder-Rollen gearbeitet wird — was produktiv nicht vorgesehen
ist (Abschnitt 7).

---

## 12. Zurückgenommene Annahmen

Aussagen, die in früheren Fassungen dieser Analyse standen und **falsch**
waren. Hier dokumentiert, damit sie nicht über alte Notizen zurückkehren.

| Frühere Behauptung | Richtigstellung |
|---|---|
| `dynamic_approver_ids` sei ein Array von Personen-IDs | Es ist ein Array von **Rollen-Tokens**. `"1"` = Manager, nicht Person 1 |
| Placeholders seien bei Monads technisch blockiert (403, Plan-Gating/Berechtigung) | Gilt nur für die `/placeholders`-Ressource. **Placeholder-Personen sind voll lesbar**; die echte Org hat schlicht keine (Abschnitt 7) |
| Das Manager-Genehmigungsprinzip sei vom Live-Test widerlegt | Teilweise. Es liegt weder am Token noch am Manager, sondern an der `approval_policy_assignment` der Person (Abschnitt 5a) |
| Die sofortige Genehmigung komme daher, dass ein **Admin-Key** verwendet wurde | **Falsch.** Derselbe Token erzeugte im A/B-Test beide Verhaltensweisen. Entscheidend ist die Approval-Policy der gebuchten Person (Abschnitt 5a) |
| Ein gesetzter `manager` genüge, damit die Manager-Genehmigung greift | Nein. Personen mit Manager, aber ohne Approval-Policy werden sofort genehmigt (Abschnitt 5a) |
| Entitlements seien vollständig ignorierbar | Fachlich ja, **technisch nein**: Für Abwesenheitstypen mit begrenztem Kontingent scheitert das Anlegen mit `entitlements_required` (Abschnitt 5b) |
| Feiertage seien möglicherweise genehmigungspflichtig, weil `limitation_type_id: 2` | Nein, sie sind es nicht. Das Feld taugt nicht als Prädiktor (Abschnitt 6) |
| `draft` gelte nur für Projekt-Bookings, nicht für Abwesenheits-Bookings | Nicht in der Doku belegt, eigene Vermutung. Beide beobachteten Typen hatten `draft: false`; ein Fall mit `true` wurde nie gesehen. Offen |
| Frage 6 („Militär") sei „geklärt (Out of Scope)" wie Frage 5 | Irreführend. Frage 5 ist Out of Scope, Frage 6 ist ein **verbindlicher Architektur-Grundsatz** (kein Hartkodieren von Kategorien) |
| Die `booking_method_id`-Tabelle beschreibe je genau ein Pflichtfeld | Gilt beim Schreiben. Ein echter Datensatz mit Methode 2 hatte zusätzlich `time` und `total_time` gefüllt |
| Der UI-Test der Personensuche erfülle die Admin-Ansicht-Abhängigkeit | Nein. Er belegt nur denselben Rechte-Effekt visuell. Die Bookings-/Approval-Konfiguration wurde nie eingesehen |
| Der Ablageort sei ein Zielkonflikt (Task nennt Confluence) | Kein Konflikt — Confluence existiert bei Monads nicht, die Task-Formulierung war ein Fehler |

---

## 12a. Abweichungen von den Task-Beschreibungen (bei der Umsetzung entstanden)

Die drei MCP-Dev-Tasks (18812914, 18812916, 18812919) enthalten Vorgaben, die
sich beim Bauen als sachlich falsch oder als Widerspruch zu Fabians eigenen
Regeln erwiesen haben. Umgesetzt wurde jeweils die funktionierende Variante;
hier steht, wo bewusst abgewichen wurde. **Mit Fabian gegenlesen.**

| # | Vorgabe im Task | Umgesetzt | Warum |
|---|---|---|---|
| 1 | „Mapping `absence_type` → Booking-Attribute … Konstante/Enum mit Mapping-Tabelle" (18812914, 18812916) | Laufzeit-Auflösung über `GET /events`, zusätzlich das Tool `list_absence_types` | Ein Enum mit Abwesenheitstypen im Code ist genau das Hartkodieren von Kategorien, das Fabian am 2026-08-20 ausgeschlossen hat. Die Task-Vorgabe widerspricht seiner eigenen Regel |
| 2 | „aggregiert Bookings + **Entitlements (Soll-Arbeitszeit)**" (18812919) | Soll-Arbeitszeit aus `availabilities` auf der Person | Entitlements sind Abwesenheits-Kontingente, keine Arbeitszeit. Mit Entitlements gerechnet käme Unsinn heraus |
| 3 | „Service-ID gemäss BA-Spezifikation" für Abwesenheiten (18812914) | Abwesenheiten nutzen `event_id`, nur Kapazität nutzt `service_id` | Es gibt keinen Abwesenheits-Service; die Trennung läuft über die Relationship |
| 4 | „unterschiedlicher `booking_type`/Zielobjekt" (18812919) | Unterscheidung über gesetzte Relationship (`event` vs. `service`) | `booking_type` existiert weder als Attribut noch als funktionierender Filter. Als **Attribut** führt die Response es nicht. Als **Filter** ist es zwar dokumentiert (`x-filters.booking` in `docs/api-spec/resources/bookings.yaml`) und wird mit HTTP 200 akzeptiert, filtert aber nachweislich nicht: am 2026-09-05 gegen die Sandbox (196 Bookings, 63 Abwesenheiten, 133 Projekt-Bookings) liefert **jeder** Wert — 1/2/3, `absence`, `project`, `time_off`, `remote_work`, auch in `[eq]`-Schreibweise — die ungefilterte Menge. Serverseitig trennbar sind nur die Abwesenheiten, über `filter[event_id]` mit allen Event-IDs (63 Zeilen, exakt die clientseitige Zählung); `filter[event_id][not_eq]` über dieselben IDs gibt 0 statt 133, matcht also nur innerhalb der Bookings mit Event. Regression: `tests/integration/bookings-filters.integration.test.ts` |
| 5 | „Berechtigungsgrenzen serverseitig durchgesetzt, nicht nur clientseitig gefiltert" (18812916) | Keine eigene Durchsetzung; stattdessen Hinweis in der Ausgabe | Die API schränkt bereits selbst ein. Eine zusätzliche Schicht im Tool wäre wirkungslos und würde Sicherheit vortäuschen |
| 6 | „Überbuchung … warnen oder hart blockieren" (18812919) | Warnen, nie blockieren | Fabians Priorisierung vom 2026-08-26: Überbuchungswarnungen sind nachrangig |
| 7 | „ein zentraler Bookings-API-Wrapper in `src/api/bookings-client.ts`" (18812919) | `bookings-client.ts` enthält die geteilte, API-freie Logik; die HTTP-Methoden liegen wie bei allen anderen Ressourcen in `client.ts` | Erfüllt die Absicht (keine drei Parallel-Implementierungen) und bleibt bei der Repo-Konvention. `makeRequest` ist privat, ein zweiter HTTP-Client hätte Auth und Fehlerbehandlung dupliziert |

**Zusätzlich beim Sandbox-Test aufgefallen und behoben:**

- Ein Kapazitätsbericht zeigte gleichzeitig „Utilisation: 0%" und
  „OVERBOOKED" — richtig gerechnet (keine Projektzeit, aber Abwesenheit über
  dem Soll), als Anzeige aber widersprüchlich. Jetzt werden Projektanteil und
  gesamter beanspruchter Anteil getrennt ausgewiesen.
- `POST /bookings` kann mit *"unavailable for booking during selected period
  for chosen person"* scheitern, wenn das Budget des Service den Zeitraum nicht
  abdeckt. Wird abgefangen und erklärt.

---

## 13. Doku-Schulden im Repo

Der lokale API-Spec-Scraper (`docs/api-spec/productive_to_openapi.py`) nutzt
die alte URL-Struktur (`developer.productive.io/<resource>.html`), die
inzwischen 404 liefert — die Doku wurde auf `/reference/resources/...`
umgestellt. Der gecachte Output `docs/api-spec/resources/placeholders.yaml`
spiegelt noch die alte, dünnere Struktur (nur Filter-/Sort-Parameter, keine
Attributliste) und sollte bei Gelegenheit neu generiert werden.

---

## 14. Prüfstand: was wie belegt ist

| Aussage | Beleg |
|---|---|
| Auth-Header und Basis-URL | `src/api/client.ts`, keine neue Recherche |
| Abgrenzung Booking / Time Entry / Event | Doku + zwei echte Datensätze |
| Events der echten Org | echte API-Abfrage, ein Datensatz zusätzlich einzeln gegengeprüft |
| Booking-Feldstruktur | 197 Sandbox-Datensätze (Admin-Sicht), zwei davon vollständig ausgewertet |
| Payload-Format `POST /bookings` | eigener Live-Test gegen die Sandbox |
| Genehmigungs-Verhalten | A/B-Test mit vier echten Buchungen; Ursache (`approval_policy_assignment`) per API bestimmt |
| Feiertage nicht genehmigungspflichtig | fachliche Auskunft Fabian |
| `booking_method_id`-Ableitung | beide Fälle (`half_day_bookings` true/false) durch erfolgreiche Buchungen bestätigt |
| Placeholder-Personen | echte Sandbox-Datensätze + Negativbefund echte Org (Status 200) |
| `/placeholders`-Ressource | ausschliesslich Doku, kein echter Datensatz |
| Soll-Arbeitszeit `availabilities` | alle 8 Personen der echten Org, anonymisiert ausgewertet |
| Kapazitäts-Auswertungen | mit Fabian abgestimmt und priorisiert; der Toolpfad inzwischen live gegen die Sandbox gefahren (siehe unten), nicht gegen Produktivdaten |
| Bookings-Filter (`event_id`, `person_id`, `project_id`, `booking_type`) | 2026-09-05 gegen die Sandbox gemessen, jeweils gegen eine selbst gezählte Referenzmenge von 196 Bookings (Spec, Abschnitt 4). Als Regression abgelegt: `tests/integration/bookings-filters.integration.test.ts` |
| Toolpfad end-to-end | über `handleToolCall` gegen die Sandbox: `list_absence_types` (sechs Typen, alle „Time off"), `list_absences` (auch mit `absence_type: 'Vacation'`), `list_bookings` (mit und ohne `project_id`), `get_capacity_overview` (Team und Einzelperson) |
| Fehlerpfade der Tools | `update_booking` mit erfundener ID liefert **-32602 InvalidParams** statt wie zuvor InternalError; `create_booking` mit nicht-numerischer `person_id` bricht in 0 ms ab, ohne die API anzufassen |
| Remote-Work-Pfad | Remote-Typ und Testbuchung in der Sandbox angelegt, ausgelesen und beides wieder entfernt (Org steht wieder bei 196 Bookings und sechs Event-Typen). 16 h Homeoffice in einer 40-Stunden-Woche: `Absence: 0m · Remote: 16h`, `Free: 40h` — vorher wären daraus 24 h freie Kapazität geworden. `list_absences` blendet die Buchung per Default aus und nennt die Anzahl, `list_absence_types` rendert „Remote work · no allowance needed" ohne Paid/Unpaid |
| Remote-Typen sind zwingend unbezahlt | `POST /events` mit `absence_type: 'remote_work'` und `event_type_id: 1` → **422 „must be unpaid for remote work absence"**; nur `event_type_id: 2` wird angelegt. Damit ist das weggelassene Paid/Unpaid-Segment gemessen, nicht aus der Spec abgeleitet |
| Event-Typen löschen | `DELETE /api/v2/events/{id}` → **409 `record_not_archived`**, solange der Typ aktiv ist; erst nach `PATCH /api/v2/events/{id}/archive` liefert derselbe DELETE ein 204. Ein Cleanup, der nur löscht, lässt seine Testdaten stehen (genau so passiert) |
| Kontingent-Pflicht bei begrenzten Event-Typen | 422 `entitlements_required` reproduziert, Gegenprobe mit unbegrenztem Typ erfolgreich |
| Approval-Policies echte Org | `GET /people?include=approval_policy_assignment`, 4 von 8 |
| Echte Monads-Org, schreibend | **nicht getestet** |
