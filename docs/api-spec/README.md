# Productive.io API Spec

Dieses Verzeichnis enthält den Scraper und die generierte OpenAPI 3.0 Spec
für die Productive.io REST API.

## Setup

```bash
pip install requests beautifulsoup4 pyyaml
```

## Verwendung

```bash
# Alle Resources scrapen (~2 Minuten)
python productive_to_openapi.py

# Custom Output-Pfad
python productive_to_openapi.py --out ./productive-openapi.yaml

# Custom Changelog-Pfad
python productive_to_openapi.py --changelog ./CHANGELOG.md
```

## Generierte Dateien

| Datei | Beschreibung |
|-------|-------------|
| `productive-openapi.yaml` | Vollständige OpenAPI 3.0 Spec (für Codegen) |
| `resources/_index.yaml` | Kompakter Index aller Resources + Endpoints |
| `resources/{slug}.yaml` | Einzelne Resource-Spec (zum gezielten Lesen) |
| `CHANGELOG.md` | Changelog: neue/entfernte Endpoints, geänderte Parameter/Schemas |

## Verwendung in Claude Code

Die generierte `productive-openapi.yaml` wird über die `CLAUDE.md` in diesem
Verzeichnis als Kontext für Claude Code eingebunden.

## Codegen (optional)

```bash
# .NET typed client via Kiota
kiota generate -l CSharp -d productive-openapi.yaml \
  -n Monads.Productive -o ./src/ProductiveClient

# .NET via NSwag
nswag openapi2csclient /input:productive-openapi.yaml \
  /output:ProductiveClient.cs /namespace:Monads.Productive
```
