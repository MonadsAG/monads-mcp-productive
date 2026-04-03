#!/usr/bin/env python3
"""
Productive.io API -> OpenAPI 3.0 YAML Converter
Scrapes https://developer.productive.io and generates a machine-readable OpenAPI spec.
Compares with previous spec and appends semantic changelog.

Usage:
    python productive_to_openapi.py
    python productive_to_openapi.py --out productive-openapi.yaml
    python productive_to_openapi.py --changelog CHANGELOG.md

Requirements:
    pip install requests beautifulsoup4 pyyaml
"""

import re
import sys
import json
import time
import argparse
from datetime import date
import requests
from pathlib import Path
from bs4 import BeautifulSoup, Tag
import yaml

BASE_URL    = "https://developer.productive.io"
API_BASE    = "https://api.productive.io/api/v2"
DEFAULT_OUT       = Path(__file__).parent / "productive-openapi.yaml"
DEFAULT_CHANGELOG = Path(__file__).parent / "CHANGELOG.md"


# --- Helpers ------------------------------------------------------------------

def fetch_page(slug: str) -> BeautifulSoup | None:
    url = f"{BASE_URL}/{slug}.html#{slug}"
    for attempt in range(3):
        try:
            r = requests.get(url, timeout=15)
            if r.status_code == 200:
                return BeautifulSoup(r.text, "html.parser")
            print(f"  WARNING  {slug}: HTTP {r.status_code}", file=sys.stderr)
            return None
        except Exception as e:
            if attempt < 2:
                time.sleep(1)
            else:
                print(f"  ERROR  {slug}: {e}", file=sys.stderr)
    return None


def to_camel(s: str) -> str:
    return "".join(w.capitalize() for w in s.replace("-", "_").split("_"))


def snake_to_title(s: str) -> str:
    return s.replace("_", " ").replace("-", " ").title()


def infer_schema(obj) -> dict:
    if obj is None:
        return {"nullable": True, "type": "string"}
    if isinstance(obj, bool):
        return {"type": "boolean"}
    if isinstance(obj, int):
        return {"type": "integer"}
    if isinstance(obj, float):
        return {"type": "number"}
    if isinstance(obj, str):
        if re.match(r"^\d{4}-\d{2}-\d{2}T", obj):
            return {"type": "string", "format": "date-time"}
        if re.match(r"^\d{4}-\d{2}-\d{2}$", obj):
            return {"type": "string", "format": "date"}
        return {"type": "string"}
    if isinstance(obj, list):
        return {"type": "array", "items": infer_schema(obj[0]) if obj else {}}
    if isinstance(obj, dict):
        return {"type": "object", "properties": {k: infer_schema(v) for k, v in obj.items()}}
    return {}


def extract_json_schema(json_str: str) -> dict:
    try:
        return infer_schema(json.loads(json_str))
    except Exception:
        return {"type": "object"}


def type_hint_to_schema(hint: str) -> dict:
    t = hint.lower()
    if "array"    in t: return {"type": "array", "items": {"type": "string"}}
    if "datetime" in t: return {"type": "string", "format": "date-time"}
    if "date"     in t: return {"type": "string", "format": "date"}
    if "bool"     in t: return {"type": "boolean"}
    if "integer"  in t: return {"type": "integer"}
    return {"type": "string"}


def make_operation_id(method: str, path: str) -> str:
    parts = path.replace("/api/v2/", "").replace("{", "").replace("}", "").split("/")
    return method + "".join(to_camel(p) for p in parts if p)


def infer_path_params(path: str) -> list[dict]:
    return [
        {"name": n, "in": "path", "required": True,
         "schema": {"type": "integer"}, "description": f"{n} of the resource"}
        for n in re.findall(r"\{(\w+)\}", path)
    ]


def extract_code_blocks(node) -> list[str]:
    return [(pre.find("code") or pre).get_text() for pre in node.find_all("pre")]


# --- Index discovery ----------------------------------------------------------

def get_all_slugs() -> list[str]:
    soup = fetch_page("index")
    if not soup:
        return []
    skip = {"index", "document_format", "error_handling", "faq",
            "importing_docs_via_api", "resource_representation",
            "working_with_attachments", "working_with_custom_fields"}
    slugs, seen = [], set()
    for a in soup.find_all("a", href=True):
        m = re.match(r"([\w_-]+)\.html", a["href"])
        if m:
            s = m.group(1)
            if s not in skip and s not in seen:
                slugs.append(s)
                seen.add(s)
    return slugs


# --- Page parser --------------------------------------------------------------

def parse_filter_params(soup: BeautifulSoup) -> list[dict]:
    params = []
    for h in soup.find_all(["h3", "h4"]):
        if "filter" in h.get_text().lower():
            ul = h.find_next_sibling("ul")
            if ul:
                for li in ul.find_all("li"):
                    m = re.match(r"(\w+)\s*(?:\(([^)]+)\))?", li.get_text(strip=True))
                    if m:
                        name, hint = m.group(1), m.group(2) or "string"
                        params.append({
                            "name": f"filter[{name}]", "in": "query", "required": False,
                            "schema": type_hint_to_schema(hint),
                            "description": f"Filter by {name} ({hint})",
                        })
    return params


def parse_sort_params(soup: BeautifulSoup) -> list[str]:
    for h in soup.find_all(["h3", "h4"]):
        if "sort" in h.get_text().lower():
            ul = h.find_next_sibling("ul")
            if ul:
                return [li.get_text(strip=True) for li in ul.find_all("li")]
    return []


def parse_resource_page(slug: str) -> list[dict]:
    soup = fetch_page(slug)
    if not soup:
        return []

    filter_params = parse_filter_params(soup)
    sort_params   = parse_sort_params(soup)

    pagination = [
        {"name": "page[number]", "in": "query", "required": False,
         "schema": {"type": "integer", "default": 1}},
        {"name": "page[size]",   "in": "query", "required": False,
         "schema": {"type": "integer", "default": 30, "maximum": 200}},
    ]
    sort_param = {
        "name": "sort", "in": "query", "required": False,
        "schema": {"type": "string",
                   "enum": sort_params + [f"-{s}" for s in sort_params]},
        "description": "Sort field. Prefix - for descending.",
    } if sort_params else None

    operations: list[dict] = []
    seen: set[str] = set()

    for heading in soup.find_all(["h3", "h4", "h5"]):
        text = heading.get_text(" ", strip=True)
        m = re.search(r"\b(GET|POST|PATCH|PUT|DELETE)\b.*?(/api/v2/[^\s`\)\"]+)", text)
        if not m:
            code = heading.find("code")
            if code:
                m = re.search(r"\b(GET|POST|PATCH|PUT|DELETE)\b.*?(/api/v2/[^\s`\)\"]+)",
                               code.get_text())
        if not m:
            continue

        method = m.group(1).lower()
        path   = re.sub(r"/\d+(?=/|$)", "/{id}", m.group(2).rstrip(".,;"))
        path   = re.sub(r"/\d+/(\w+)$",  r"/{id}/\1", path)
        key    = f"{method}:{path}"
        if key in seen:
            continue
        seen.add(key)

        summary = re.sub(r"\[(?:GET|POST|PATCH|PUT|DELETE)\]|/api/v2/[^\s]+|`[^`]*`", "", text).strip(" -[]")

        path_params = infer_path_params(path)
        params      = list(path_params)
        if method == "get" and not path_params:
            params += filter_params + pagination
            if sort_param:
                params.append(sort_param)

        # Request body
        request_body = None
        if method in ("post", "patch", "put"):
            sibling   = heading.find_next_sibling()
            body_json = None
            for _ in range(20):
                if not sibling:
                    break
                if isinstance(sibling, Tag) and sibling.name in ("h3", "h4", "h5"):
                    break
                for code in extract_code_blocks(sibling):
                    if '"data"' in code and '"type"' in code:
                        body_json = code
                        break
                if body_json:
                    break
                sibling = sibling.find_next_sibling()

            schema = extract_json_schema(body_json) if body_json else {
                "type": "object",
                "properties": {"data": {"type": "object", "properties": {
                    "type":          {"type": "string"},
                    "attributes":    {"type": "object"},
                    "relationships": {"type": "object"},
                }}}
            }
            request_body = {"required": True,
                            "content": {"application/vnd.api+json": {"schema": schema}}}

        # Response schema
        resp_schema = None
        sibling = heading.find_next_sibling()
        for _ in range(20):
            if not sibling:
                break
            if isinstance(sibling, Tag) and sibling.name in ("h3", "h4"):
                break
            for code in extract_code_blocks(sibling):
                if '"data"' in code:
                    resp_schema = extract_json_schema(code)
                    break
            if resp_schema:
                break
            sibling = sibling.find_next_sibling()

        if not resp_schema:
            resp_schema = {"type": "object",
                           "properties": {"data": {}, "meta": {"type": "object"}}}

        op: dict = {
            "method":      method,
            "path":        path,
            "summary":     summary or f"{method.upper()} {path}",
            "operationId": make_operation_id(method, path),
            "tags":        [snake_to_title(slug)],
            "parameters":  params,
            "responses": {
                ("201" if method == "post" else "200"): {
                    "description": "Success",
                    "content": {"application/vnd.api+json": {"schema": resp_schema}},
                },
                "401": {"description": "Unauthorized"},
                "403": {"description": "Forbidden"},
                "422": {"description": "Validation error"},
            },
        }
        if request_body:
            op["requestBody"] = request_body
        if method == "delete":
            op["responses"] = {"204": {"description": "Deleted"},
                               "404": {"description": "Not found"}}
        operations.append(op)

    # Fallback: bare inline code
    if not operations:
        for code in soup.find_all("code"):
            m = re.match(r"(GET|POST|PATCH|PUT|DELETE)\s+(/api/v2/\S+)", code.get_text(strip=True))
            if m:
                method = m.group(1).lower()
                path   = re.sub(r"/\d+", "/{id}", m.group(2))
                key    = f"{method}:{path}"
                if key in seen:
                    continue
                seen.add(key)
                operations.append({
                    "method": method, "path": path,
                    "summary": f"{method.upper()} {path}",
                    "operationId": make_operation_id(method, path),
                    "tags": [snake_to_title(slug)],
                    "parameters": infer_path_params(path),
                    "responses": {"200": {"description": "Success"}},
                })

    print(f"  OK  {slug}: {len(operations)} operations", file=sys.stderr)
    return operations


# --- OpenAPI builder ----------------------------------------------------------

def build_openapi(operations: list[dict]) -> dict:
    paths: dict = {}
    for op in operations:
        path, method = op["path"], op["method"]
        entry = {k: op[k] for k in
                 ("summary", "operationId", "tags", "parameters", "responses") if k in op}
        if "requestBody" in op:
            entry["requestBody"] = op["requestBody"]
        paths.setdefault(path, {})[method] = entry

    return {
        "openapi": "3.0.3",
        "info": {
            "title": "Productive.io API",
            "description": (
                "REST API - Productive.io (project management, time tracking, invoicing).\n"
                "Spec: JSON API (https://jsonapi.org/)\n"
                "Docs: https://developer.productive.io\n\n"
                "Auth headers on every request:\n"
                "  X-Auth-Token: <token>       (Settings > API integrations)\n"
                "  X-Organization-Id: <org_id>\n\n"
                "Pagination: page[number] (default 1), page[size] (default 30, max 200)\n"
                "Rate limits: 100 req/10s | 4000 req/30min | Reports: 10 req/30s"
            ),
            "version": "2.0.0",
        },
        "servers":  [{"url": API_BASE}],
        "security": [{"ApiKeyAuth": [], "OrgIdHeader": []}],
        "components": {
            "securitySchemes": {
                "ApiKeyAuth":  {"type": "apiKey", "in": "header", "name": "X-Auth-Token"},
                "OrgIdHeader": {"type": "apiKey", "in": "header", "name": "X-Organization-Id"},
            },
        },
        "paths": paths,
    }


# --- YAML output --------------------------------------------------------------

class _Literal(str):
    pass

yaml.add_representer(
    _Literal,
    lambda d, s: d.represent_scalar("tag:yaml.org,2002:str", s, style="|")
)

def dump_yaml(spec: dict) -> str:
    if "description" in spec.get("info", {}):
        spec["info"]["description"] = _Literal(spec["info"]["description"])
    return yaml.dump(spec, allow_unicode=True, sort_keys=False, default_flow_style=False)


# --- Changelog ----------------------------------------------------------------

def load_previous_spec(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, default=str)


def _sort_params(params: list[dict]) -> list[dict]:
    return sorted(params, key=lambda p: (p.get("name", ""), p.get("in", "")))


def compare_specs(old: dict, new: dict) -> dict:
    old_paths = set(old.get("paths", {}).keys())
    new_paths = set(new.get("paths", {}).keys())

    paths_added   = sorted(new_paths - old_paths)
    paths_removed = sorted(old_paths - new_paths)

    ops_added:   list[tuple[str, str]] = []
    ops_removed: list[tuple[str, str]] = []
    ops_changed: list[dict] = []

    for path in sorted(old_paths & new_paths):
        old_methods = set(old["paths"][path].keys())
        new_methods = set(new["paths"][path].keys())

        for m in sorted(new_methods - old_methods):
            ops_added.append((m.upper(), path))
        for m in sorted(old_methods - new_methods):
            ops_removed.append((m.upper(), path))

        for m in sorted(old_methods & new_methods):
            old_op = old["paths"][path][m]
            new_op = new["paths"][path][m]
            changes = []

            old_params = _sort_params(old_op.get("parameters", []))
            new_params = _sort_params(new_op.get("parameters", []))
            if _canonical(old_params) != _canonical(new_params):
                changes.append("parameters changed")

            if _canonical(old_op.get("requestBody")) != _canonical(new_op.get("requestBody")):
                changes.append("request body changed")

            if _canonical(old_op.get("responses")) != _canonical(new_op.get("responses")):
                changes.append("responses changed")

            if old_op.get("summary") != new_op.get("summary"):
                changes.append("summary changed")

            if changes:
                ops_changed.append({"method": m.upper(), "path": path, "changes": changes})

    # Operations on entirely new/removed paths
    for path in paths_added:
        for m in sorted(new["paths"][path].keys()):
            ops_added.append((m.upper(), path))
    for path in paths_removed:
        for m in sorted(old["paths"][path].keys()):
            ops_removed.append((m.upper(), path))

    return {
        "paths_added": paths_added,
        "paths_removed": paths_removed,
        "operations_added": ops_added,
        "operations_removed": ops_removed,
        "operations_changed": ops_changed,
    }


def format_changelog_entry(diff: dict | None, stats: dict) -> str:
    today = date.today().isoformat()
    lines = [f"## {today}", "",
             f"**Spec stats:** {stats['paths']} paths, {stats['operations']} operations", ""]

    if diff is None:
        lines.append("Initial spec generated.")
        lines += ["", "---", ""]
        return "\n".join(lines)

    has_changes = any(diff[k] for k in diff)
    if not has_changes:
        lines.append("No changes detected.")
        lines += ["", "---", ""]
        return "\n".join(lines)

    if diff["paths_added"]:
        lines.append(f"### New paths ({len(diff['paths_added'])})")
        for p in diff["paths_added"]:
            lines.append(f"- `{p}`")
        lines.append("")

    if diff["paths_removed"]:
        lines.append(f"### Removed paths ({len(diff['paths_removed'])})")
        for p in diff["paths_removed"]:
            lines.append(f"- `{p}`")
        lines.append("")

    if diff["operations_added"]:
        lines.append(f"### New operations ({len(diff['operations_added'])})")
        for method, path in diff["operations_added"]:
            lines.append(f"- `{method} {path}`")
        lines.append("")

    if diff["operations_removed"]:
        lines.append(f"### Removed operations ({len(diff['operations_removed'])})")
        for method, path in diff["operations_removed"]:
            lines.append(f"- `{method} {path}`")
        lines.append("")

    if diff["operations_changed"]:
        lines.append(f"### Changed operations ({len(diff['operations_changed'])})")
        for op in diff["operations_changed"]:
            detail = ", ".join(op["changes"])
            lines.append(f"- `{op['method']} {op['path']}` — {detail}")
        lines.append("")

    lines += ["---", ""]
    return "\n".join(lines)


def write_changelog(entry: str, path: Path) -> None:
    header = "# Productive.io API Changelog\n\n"
    existing = ""
    if path.exists():
        content = path.read_text(encoding="utf-8")
        # Strip header to avoid duplication
        if content.startswith("# "):
            first_nl = content.index("\n")
            existing = content[first_nl + 1:].lstrip("\n")
        else:
            existing = content

    path.write_text(header + entry + "\n" + existing, encoding="utf-8")


# --- Main ---------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Productive.io docs -> OpenAPI 3.0 YAML")
    parser.add_argument("--out",       default=str(DEFAULT_OUT),       help="Output YAML file.")
    parser.add_argument("--changelog", default=str(DEFAULT_CHANGELOG), help="Changelog file.")
    args = parser.parse_args()

    print("Fetching index to discover all resources...", file=sys.stderr)
    slugs = get_all_slugs()

    if not slugs:
        print("ERROR: Could not discover any resources.", file=sys.stderr)
        sys.exit(1)

    print(f"\nScraping {len(slugs)} resource(s)...\n", file=sys.stderr)

    operations: list[dict] = []
    for slug in slugs:
        operations.extend(parse_resource_page(slug))
        time.sleep(0.2)

    spec     = build_openapi(operations)
    out_path = Path(args.out)
    changelog_path = Path(args.changelog)

    # Load previous spec BEFORE writing the new one
    old_spec = load_previous_spec(out_path)

    # Write new spec
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(dump_yaml(spec), encoding="utf-8")

    total = sum(len(v) for v in spec["paths"].values())
    print(f"\nDone: {out_path}", file=sys.stderr)
    print(f"  Paths: {len(spec['paths'])}  |  Operations: {total}", file=sys.stderr)

    # Generate and write changelog
    stats = {"paths": len(spec["paths"]), "operations": total}
    if old_spec:
        diff  = compare_specs(old_spec, spec)
        entry = format_changelog_entry(diff, stats)
    else:
        entry = format_changelog_entry(None, stats)

    write_changelog(entry, changelog_path)
    print(f"  Changelog: {changelog_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
