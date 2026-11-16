<!-- Mirrored from https://developer.productive.io/guides/rate-limits -- regenerate with `npm run spec:guides` -->

The API enforces three independent limits: how many requests you send, how many of them run at the same time, and how much server processing time they consume. Exceeding any of them returns `429 Too Many Requests`.

## Request count

- **Per API token** — 100 requests per 10 seconds
- **Per organization** — 10,000 requests per hour
- **`/reports` endpoints, per API token** — 10 requests per 30 seconds
- **Bulk requests, per API token and resource** — 10 requests per 30 seconds. A bulk request (`ext=bulk`, see [Content negotiation](/guides/content-negotiation)) carries up to 100 records, so this still allows 1,200 records a minute. Each resource has its own bucket, e.g. `/time_entries` and `/bookings` are counted separately.

## Concurrent requests

- **Per organization** — 16 requests in progress at the same time

A request is in progress from the moment it reaches the API until its response is sent. The limit is shared by every API token and integration in the organization. A request that arrives while 16 others are still running is rejected straight away, so it costs no processing time, but it still counts toward the request count limits.

## Server processing time

Requests differ enormously in cost — a lookup finishes in milliseconds, a wide report keeps a server busy for seconds. Each request is timed and its duration is added to your organization's budget:

- **Per minute** — 2 minutes of processing time, which you can only reach by running multiple requests in parallel
- **Per hour** — 30 minutes of processing time
- **Per day** — 6 hours of processing time

Windows are fixed: the per-minute budget resets at the start of every minute, the hourly one at the top of each hour, the daily one at midnight UTC.

## When you hit a limit

``` json
{
    "errors": [
        {
            "status": 429,
            "title": "Server time limit exceeded",
            "detail": "Server time limit reached. Try again later",
            "limit": 1800,
            "period": 3600
        }
    ]
}
```

`limit` and `period` are in seconds for the processing time limit — above, 1,800 seconds of work within a 3,600 second window. For a request count limit they are in requests, and `title` is `Too many requests` instead.

For the concurrent request limit, `title` is `Concurrency limit exceeded` and `limit` is the number of requests allowed in progress at once:

``` json
{
    "errors": [
        {
            "status": 429,
            "title": "Concurrency limit exceeded",
            "detail": "Too many concurrent requests. Try again shortly",
            "limit": 16
        }
    ]
}
```

The `X-RateLimit-Reset` header tells you how many seconds remain until the window resets. If more than one processing time budget is used up, the response reports the longest window, so waiting out `X-RateLimit-Reset` clears all of them. Wait it out rather than retrying in a loop. For the concurrent request limit `X-RateLimit-Reset` is `1`: retry once one of your running requests has finished, with a short backoff.

## What to watch out for

- Cap your parallelism. Run requests through a worker pool or queue with a fixed number of workers rather than starting them all at once, and keep the total across all your integrations at 16 or fewer.
- Use Webhooks instead of polling. Re-reading resources on a schedule to detect changes is the most common way to burn through the processing time budget.
- Filter narrowly. Unbounded date ranges on reports are by far the most expensive calls in the API.
- Only include what you use. Every relationship adds work on the server.
- Cache reference data such as services, workflow statuses, custom fields and people.
- Use bulk requests for imports instead of one request per record.
