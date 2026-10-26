<!-- Mirrored from https://developer.productive.io/guides/exporting-the-financial-item-report -- regenerate with `npm run spec:guides` -->


The Financial Item report supports cursor pagination through the `page[after]` parameter.
Use it to export the whole report. Every page costs the same regardless of how deep into the
report it is, so the export does not get slower as it goes.

`GET https://api.productive.io/api/v2/reports/financial_item_reports`

Cursor pagination is opt-in per request. Without `page[after]` the report paginates with
`page[number]` exactly as before.

This guide covers what is specific to the Financial Item report. The general rules for cursor
pagination are described in [Pagination](guide:pagination)

NOTE: The Financial Item report is currently the only report that supports cursor pagination.
Other report endpoints return `400 keyset_unsupported_sort` for `page[after]`.

## Requirements

A request has to meet all of the conditions below. If it misses any of them, the request
returns a `400` error naming the reason. It does not fall back to page-based pagination.

1. **Send `page[after]`, empty on the first request.** Its presence is what opts the request
   in. Without it you get page-based pagination.
2. **Do not send `page[number]`.** Sending both returns `keyset_conflict`.
3. **Filter on exactly one `financial_item_type`.** Exporting several types means one crawl
   per type.
4. **Do not send any other filter.** `filter[financial_item_type]` is the only filter
   accepted on this path. Date range, project and budget filters are not supported here, so
   narrow the rows on your side after the export.
5. **Do not send a `group` parameter.** The crawl runs at the financial item level: one row
   per underlying record.
6. **Do not send a `sort` parameter.** The cursor defines the order.
7. **Use a token whose user can view all budgets and all deals.** A user with restricted
   visibility gets `report_keyset_restricted_access` and has to use `page[number]` instead.

`include` and sparse fieldsets (`fields[...]`) work as usual.

## Parameters

| Parameter | Value | Notes |
| --- | --- | --- |
| `page[after]` | empty, then the cursor from the response | Required. Send it empty to start, after that you never set it by hand |
| `page[size]` | `1`-`1000` | 30 by default. Values above the maximum are reduced to it, not rejected |
| `filter[financial_item_type][eq][]` | one item type | Required, exactly one value |
| `include` | comma-separated relationships | Optional. Has the largest effect on how long a page takes, so request only what you use |
| `fields[...]` | sparse fieldsets | Optional |

## Requesting the first page

``` bash
curl -sS -G 'https://api.productive.io/api/v2/reports/financial_item_reports' \
  -H 'X-Auth-Token: '"$PRODUCTIVE_AUTH_TOKEN" \
  -H 'X-Organization-Id: '"$PRODUCTIVE_ORGANIZATION_ID" \
  -H 'Content-Type: application/vnd.api+json' \
  --data-urlencode 'filter[financial_item_type][eq][]=time_entry' \
  --data-urlencode 'page[after]=' \
  --data-urlencode 'page[size]=1000'
```

## Following the cursor

The `links` section of each response contains a `next` URL. Request it as it is, and repeat
until a response comes back without a `next` link.

There is nothing to calculate on your side. You do not read an id off the last row or keep
track of a position. The server does that and returns a complete URL with your filter and
page size already carried over.

Two things to keep in mind:

- **A missing `links.next` is the only end signal.** A short page is not. A page can come
  back with fewer rows than `page[size]` and still be followed by more pages.
- **The cursor is opaque.** It encodes a position and the order it was issued under. Do not
  construct, parse or increment it, send back exactly what you were given.

The whole protocol, in pseudocode:

```
url = ".../financial_item_reports?filter[financial_item_type][eq][]=time_entry"
      + "&page[after]=&page[size]=1000"
rows = []

while url:
    response = GET(url)

    if response.status == 429:          # throttled, see Rate limits
        sleep(response.headers["X-RateLimit-Reset"])
        continue                        # the same url, not the next one

    if response.status >= 500:          # transient, see Retrying and resuming
        sleep(backoff())
        continue                        # the same url, still safe

    rows += response.body["data"]
    url = response.body["links"].get("next")   # absent means done
```

## The response

A cursor response differs from a page-based one in two places:

| Field | On a cursor page |
| --- | --- |
| `meta.page_size` | Returned, the size that was applied |
| `meta.max_page_size` | Returned, the maximum for this request |
| `meta.total_count` | Not returned |
| `meta.total_pages` | Not returned |
| `links.first` | Returned, restarts the crawl |
| `links.next` | Returned until the last page, then omitted |
| `links.last`, `links.prev` | Not returned, the crawl only goes forward |

The first page of a two page crawl, requested with `page[after]=&page[size]=2`:

``` json
{
  "data": [ { "id": "...booking_item-534..." }, { "id": "...booking_item-536..." } ],
  "meta": { "page_size": 2, "max_page_size": 1000 },
  "links": {
    "first": ".../financial_item_reports?filter[...]&page[after]=&page[size]=2",
    "next": ".../financial_item_reports?filter[...]&page[after]=eyJ2IjoxLCJzb3J0...&page[size]=2"
  }
}
```

The second page, requested by following `links.next` unchanged. It has no `next` link, so the
crawl is finished:

``` json
{
  "data": [ { "id": "...booking_item-538..." } ],
  "meta": { "page_size": 2, "max_page_size": 1000 },
  "links": {
    "first": ".../financial_item_reports?filter[...]&page[after]=&page[size]=2"
  }
}
```

NOTE: Cursor pages do not contain `total_count`, so you cannot show progress as a percentage
from them. To get a total, send one page-based request with the same type filter and
`page[size]=1` first, and read `meta.total_count` from it.

## Page size

The maximum `page[size]` on the cursor path is **1000**. Page-based requests stay capped at
200. Values above the maximum are reduced to it rather than rejected, so a request for 2000
returns 1000. Read `meta.page_size` if you need to know which value was applied.

Use the largest page you can. Rate limits are counted per request and not per row, so halving
the number of pages halves the time the export spends waiting on the limit.

## Item types

Exactly one of these per crawl:

| Value | Rows |
| --- | --- |
| `time_entry` | Time entries |
| `booking_item` | Booking items |
| `draft_booking_item` | Tentative booking items, bookings that are still drafts |
| `service` | Services on budgets and deals |
| `expense` | Expenses |
| `invoice_attribution` | Invoice attributions |
| `revenue_item` | Revenue items, only when revenue recognition is enabled on the account |

A full export is therefore several crawls, run one after another. They share the same rate
limit per API token, so running more than two or three of them in parallel does not help. A
type with no matching records returns one empty page and no `links.next`.

## Possible errors

A request that does not meet the requirements returns a `400` instead of the first page-based
page. Branch on `errors[0].code`:

| Code | Cause | Fix |
| --- | --- | --- |
| `keyset_conflict` | `page[after]` sent together with `page[number]` | Remove `page[number]` |
| `report_keyset_requires_single_type` | No `financial_item_type` filter, or more than one value | Send exactly one value, one crawl per type |
| `report_keyset_unsupported_filter` | A filter other than `financial_item_type` was sent | Remove it, or use `page[number]` |
| `report_keyset_unsupported_group` | A `group` parameter was sent | Remove it |
| `report_keyset_restricted_access` | The user cannot view all budgets and all deals | Use a token with full visibility, or use `page[number]` |
| `keyset_unsupported_sort` | A `sort` was sent, or the endpoint does not support cursor pagination | Remove `sort` |
| `keyset_invalid_cursor` | The cursor is malformed, constructed by hand, or was issued for a different item type | Restart that crawl from `page[after]=` |

NOTE: A `sort` value that is invalid on its own returns a different code
(`sort_param_unsupported`, `missing_date_period`), so handle any `400` rather than only the
codes listed here.

## Rate limits

Report endpoints allow **10 requests per 30 seconds per API token**. Keep the export under
that and you will rarely see a `429`. There is no `Retry-After` header, use these instead:

| Header | Meaning |
| --- | --- |
| `X-RateLimit-Limit` | Requests allowed in the window |
| `X-RateLimit-Remaining` | `0` while you are being limited |
| `X-RateLimit-Reset` | Seconds until the window resets, wait that long and retry the same URL |

The general rules are described in [Rate Limits](guide:rate-limits)

## Retrying and resuming

A cursor request is safe to repeat. Requesting the same `page[after]` again returns the same
page, because the position is in the URL and not in server-side state. There is no session to
lose and no page counter that can get out of step. Retry a `429` or a `5xx` against the same
URL and the export continues where it stopped.

An export that runs for several minutes will hit a transient `5xx` sooner or later, so build
the retry in from the start. If your integration stores progress, store the last cursor you
processed and resume from it.

While an export is running:

- The crawl moves forward in creation order. Records created during the export land ahead of
  the cursor and are included, records deleted during the export are not returned.
- A cursor belongs to the export that produced it. Start every new export from `page[after]=`
  instead of reusing a cursor from a previous run.
- Changing `page[size]` during an export is safe. Changing the item type is not, that cursor
  returns `keyset_invalid_cursor`.

## Complete example

A full export in Python, using the standard library only. It crawls every item type in turn,
keeps itself under the rate limit, retries limited and failed requests, and writes one JSON
Lines file per type.

<details>
<summary><strong>financial_item_export.py</strong></summary>

```python
#!/usr/bin/env python3
"""Export the Productive Financial Item report using cursor pagination.

Crawls every financial item type in turn and writes one JSON Lines file per
type. Stays inside the reports rate limit (10 requests / 30 seconds) and
retries throttled and failed requests safely.

Usage:
    export PRODUCTIVE_AUTH_TOKEN="..."
    export PRODUCTIVE_ORGANIZATION_ID="..."
    python3 financial_item_export.py
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = os.environ.get(
    "PRODUCTIVE_API_URL", "https://api.productive.io/api/v2/reports/financial_item_reports"
)
AUTH_TOKEN = os.environ["PRODUCTIVE_AUTH_TOKEN"]
ORGANIZATION_ID = os.environ["PRODUCTIVE_ORGANIZATION_ID"]

# One crawl per type. Drop any you do not need.
ITEM_TYPES = [
    "time_entry",
    "booking_item",
    "draft_booking_item",
    "revenue_item",
    "service",
    "invoice_attribution",
    "expense",
]

PAGE_SIZE = 1000          # maximum accepted on the cursor path
INCLUDE = ""              # e.g. "service,person" — adds relationships, costs time
REQUEST_TIMEOUT = 180     # seconds

RATE_LIMIT = 10           # requests ...
RATE_PERIOD = 30          # ... per this many seconds, per API token
MAX_ATTEMPTS = 6          # per page, across throttling and server errors


class RateLimiter:
    """Keeps the client under `limit` requests per rolling `period` seconds."""

    def __init__(self, limit, period):
        self.limit = limit
        self.period = period
        self.sent = []

    def wait(self):
        while True:
            now = time.monotonic()
            self.sent = [t for t in self.sent if now - t < self.period]
            if len(self.sent) < self.limit:
                self.sent.append(now)
                return
            time.sleep(self.period - (now - self.sent[0]) + 0.05)


def fetch(url, limiter):
    """GET one page, honouring 429s and retrying transient server errors.

    Re-requesting the same URL is always safe: the cursor is in the URL, so a
    retry returns the same page rather than skipping or repeating rows.
    """
    for attempt in range(MAX_ATTEMPTS):
        limiter.wait()
        request = urllib.request.Request(
            url,
            headers={
                "X-Auth-Token": AUTH_TOKEN,
                "X-Organization-Id": ORGANIZATION_ID,
                "Content-Type": "application/vnd.api+json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", "replace")
            if error.code == 429:
                reset = int(error.headers.get("X-RateLimit-Reset") or RATE_PERIOD)
                print(f"  throttled, waiting {reset}s", file=sys.stderr)
                time.sleep(reset + 1)
                continue
            if error.code >= 500:
                backoff = 2 ** attempt
                print(f"  HTTP {error.code}, retrying in {backoff}s", file=sys.stderr)
                time.sleep(backoff)
                continue
            raise SystemExit(f"HTTP {error.code} for {url}\n{body}")
        except urllib.error.URLError as error:
            backoff = 2 ** attempt
            print(f"  {error.reason}, retrying in {backoff}s", file=sys.stderr)
            time.sleep(backoff)

    raise SystemExit(f"gave up after {MAX_ATTEMPTS} attempts: {url}")


def first_page_url(item_type):
    params = [
        ("filter[financial_item_type][eq][]", item_type),
        ("page[after]", ""),
        ("page[size]", str(PAGE_SIZE)),
    ]
    if INCLUDE:
        params.append(("include", INCLUDE))
    return f"{BASE_URL}?{urllib.parse.urlencode(params)}"


def crawl(item_type, limiter):
    """Walk one type to exhaustion, writing rows to <item_type>.jsonl."""
    url = first_page_url(item_type)
    pages = 0
    rows = 0
    started = time.monotonic()

    with open(f"{item_type}.jsonl", "w", encoding="utf-8") as output:
        while url:
            body = fetch(url, limiter)
            for row in body["data"]:
                output.write(json.dumps(row, ensure_ascii=False) + "\n")
            pages += 1
            rows += len(body["data"])
            print(f"  page {pages}: {len(body['data'])} rows ({rows} total)")

            # The only end signal. A short page is not one.
            url = body.get("links", {}).get("next")

    return pages, rows, time.monotonic() - started


def main():
    limiter = RateLimiter(RATE_LIMIT, RATE_PERIOD)
    total = 0

    for item_type in ITEM_TYPES:
        print(f"{item_type}:")
        pages, rows, seconds = crawl(item_type, limiter)
        total += rows
        print(f"  done — {rows} rows, {pages} pages, {seconds:.1f}s -> {item_type}.jsonl\n")

    print(f"{total} rows exported across {len(ITEM_TYPES)} types")


if __name__ == "__main__":
    main()
```

</details>

Save it as `financial_item_export.py` and run:

``` bash
export PRODUCTIVE_AUTH_TOKEN="..."
export PRODUCTIVE_ORGANIZATION_ID="..."
python3 financial_item_export.py
```
