<!-- Mirrored from https://developer.productive.io/guides/error-handling -- regenerate with `npm run spec:guides` -->

## Possible errors

<b>400</b>
<br/>
Used when a given query param is not supported.
Possible title values: *Unsupported Filter*, *Unsupported Filter Value*, *Unsupported Sort*, *Unsupported Group*

``` json
{
    "errors": [
        {
            "status": 400,
            "title": "*one of listed values*",
            "detail": "*...* is not supported on this endpoint"
        }
    ]
}
```

<b>401</b>
``` json
{
    "errors": [
        {
            "status": 401,
            "title": "Unauthenticated",
            "detail": "You are not authenticated"
        }
    ]
}
```

<b>403</b>
``` json
{
    "errors": [
        {
            "status": 403,
            "title": "Access Denied",
            "detail": "You are not authorized to access this resource"
        }
    ]
}
```

<b>404</b>
``` json
{
    "errors": [
        {
            "status": 404,
            "title": "Record Not Found",
            "detail": "The requested record was not found"
        }
    ]
}
```

<b>406</b>
``` json
{
    "errors": [
        {
            "status": 406,
            "title": "Not Acceptable",
            "detail": "The request was not accepted"
        }
    ]
}
```

<b>415</b>
``` json
{
    "errors": [
        {
            "status": 415,
            "title": "Unsupported Media Type",
            "detail": "Unsupported content type"
        }
    ]
}
```

<b>422</b>
``` json
{
    "errors": [
        {
            "status": 422,
            "title": "Invalid Attribute",
            "detail": "Unsupported content type"
        }
    ]
}
```

<b>500</b>
``` json
{
    "errors": [
        {
            "status": 500,
            "title": "Server Error",
            "detail": "An error occured on the server"
        }
    ]
}
```
