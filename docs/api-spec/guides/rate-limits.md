<!-- Mirrored from https://developer.productive.io/guides/rate-limits -- regenerate with `npm run spec:guides` -->

The API enforces two independent limits: how many requests you send, and how much server processing time those requests consume. Exceeding either returns `429 Too Many Requests`.

## Request count

- **Per API token** — 100 requests per 10 seconds
- **Per organization** — 4,000 requests per 30 minutes
- **`/reports` endpoints, per API token** — 10 requests per 30 seconds

## Server processing time

Requests differ enormously in cost — a lookup finishes in milliseconds, a wide report keeps a server busy for seconds. Each request is timed and its duration is added to your organization's budget:

- **Per hour** — 30 minutes of processing time
- **Per day** — 6 hours of processing time

Windows are fixed: the hourly budget resets at the top of each hour, the daily one at midnight UTC.

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

The `X-RateLimit-Reset` header tells you how many seconds remain until the window resets. Wait it out rather than retrying in a loop.

## What to watch out for

- **Use [Webhooks](https://developer.productive.io/reference/resources/webhooks) instead of polling.** Re-reading resources on a schedule to detect changes is the most common way to burn through the processing time budget.
- **Filter narrowly.** Unbounded date ranges on reports are by far the most expensive calls in the API.
- **Only `include` what you use.** Every relationship adds work on the server.
- **Cache reference data** such as services, workflow statuses, custom fields and people.
