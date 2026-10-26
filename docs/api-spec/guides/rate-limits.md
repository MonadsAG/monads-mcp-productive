<!-- Mirrored from https://developer.productive.io/guides/rate-limits -- regenerate with `npm run spec:guides` -->

The API enforces two independent limits: how many requests you send, and how much server processing time those requests consume. Exceeding either returns `429 Too Many Requests`.

## Request count

- **Per API token** — 100 requests per 10 seconds
- **Per organization** — 10,000 requests per hour
- **`/reports` endpoints, per API token** — 10 requests per 30 seconds
- **Bulk requests, per API token and resource** — 10 requests per 30 seconds. A bulk request (`ext=bulk`, see [Content negotiation](/guides/content-negotiation)) carries up to 100 records, so this still allows 1,200 records a minute. Each resource has its own bucket, e.g. `/time_entries` and `/bookings` are counted separately.

## Server processing time

Requests differ enormously in cost — a lookup finishes in milliseconds, a wide report keeps a server busy for seconds. Each request is timed and its duration is added to your organization's budget:

- **Per minute** — 2 minutes of processing time, which you can only reach by running multiple requests in parallel
- **Per hour** — 30 minutes of processing time
- **Per day** — 6 hours of processing time

Bulk requests reduce the request count, not the processing time. A bulk create of 100 time entries keeps a server busy for several seconds, so a large import is bounded by the hourly budget: at the default cap that is roughly 400 bulk requests, or around 40,000 records, per hour. Pace imports against this budget rather than the request count limits.

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

limit and period are in seconds for the processing time limit — above, 1,800 seconds of work within a 3,600 second window. For a request count limit they are in requests, and title is Too many requests instead.

The X-RateLimit-Reset header tells you how many seconds remain until the window resets. If more than one processing time budget is used up, the response reports the longest window, so waiting out X-RateLimit-Reset clears all of them. Wait it out rather than retrying in a loop.

What to watch out for

- Use Webhooks instead of polling. Re-reading resources on a schedule to detect changes is the most common way to burn through the processing time budget.
- Filter narrowly. Unbounded date ranges on reports are by far the most expensive calls in the API.
- Only include what you use. Every relationship adds work on the server.
- Cache reference data such as services, workflow statuses, custom fields and people.
- Use bulk requests for imports, but pace them. Sending bulk requests as fast as the request count limits allow exhausts the hourly processing budget within minutes, and every request is rejected until the top of the hour.
