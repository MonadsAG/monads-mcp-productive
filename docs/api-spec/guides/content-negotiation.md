<!-- Mirrored from https://developer.productive.io/guides/content-negotiation -- regenerate with `npm run spec:guides` -->

`Content-Type` header must be set to `application/vnd.api+json`.

While sending bulk requests, make sure to set **both** the `Content-Type` and the `Accept` header to `application/vnd.api+json; ext=bulk`:

```
Content-Type: application/vnd.api+json; ext=bulk
Accept: application/vnd.api+json; ext=bulk
```

When `Content-Type` is not set as described, API will return **415** response status error.

When the `Accept` header is not set as described on a bulk request, the API will return a **404 Route Not Found** error, because the bulk route will not be matched.
