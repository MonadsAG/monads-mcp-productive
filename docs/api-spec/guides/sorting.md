<!-- Mirrored from https://developer.productive.io/guides/sorting -- regenerate with `npm run spec:guides` -->

To sort query results, you can use sort parameter, passing available sort params for the resource: `?sort=name`.
All available sort params are defined separately for each resource. You can provide desired sort order using `-` sign (`?sort=-name`), where no `-` defines ascending and `-` defines descending order by the given sort parameter.
If a given parameter is not supported, `Unsupported Sort` error (with status 400) will be raised:

``` json
{
    "errors": [
        {
            "status": 400,
            "title": "Unsupported Sort",
            "detail": "Sort by 'unsupported' is not supported on this endpoint"
        }
    ]
}
```
