<!-- Mirrored from https://developer.productive.io/guides/pagination -- regenerate with `npm run spec:guides` -->

## Cursor pagination [Preferred]

Collection endpoints support cursor-based pagination through the `page[after]` parameter.
Use it to read through a whole collection. To jump to a specific page or to get a total
count, use page-based pagination below.

Send an empty `page[after]` to get the first page:

`?page[after]=&page[size]=200`

The `links` section of the response contains a `next` URL. Request it to get the following
page, and repeat until a response comes back without a `next` link.

```
{
  "data": [ ... ],
  "meta": {
    "page_size": 200,
    "max_page_size": 200
  },
  "links": {
    "first": "https://api.productive.io/api/v2/activities?page[after]=&page[size]=200",
    "next": "https://api.productive.io/api/v2/activities?page[after]=eyJ2IjoxLCJzb3J0Ijo&page[size]=200"
  }
}
```

`page[after]` is an opaque cursor that defines your place in the collection. Do not construct
or parse it, the format can change.

The `meta` section is smaller than with page-based pagination:
    <br/>
    `current_page`, `total_pages` and `total_count` - not returned
    <br/>
    `page_size` - 30 by default or the value you put in `page[size]`
    <br/>
    `max_page_size` - 200

Cursor pagination is available on most collection endpoints, but not on reports. In those cases the request returns an error rather than
falling back to page-based pagination:
    <br/>
    `keyset_conflict` - `page[after]` sent together with `page[number]`
    <br/>
    `keyset_unsupported_sort` - the endpoint or the requested `sort` does not support cursor pagination
    <br/>
    `keyset_invalid_cursor` - the cursor is malformed, or was issued for a different endpoint

## Page-based pagination

Page-based pagination has to be set in the following style:

`?page[number]=2&page[size]=20`

Where `page[number]=` is the page you want to view, and `page[size]=` is the number of resources you want to return.

To check pagination settings or how many resources there are in total, check the
`meta` section in the response of your request.

There you can see the following:
    <br/>
    `current_page` - 1 by default or the value you put in `page[number]`
    <br/>
    `total_pages` - `total_count`/`page_size` rounded up
    <br/>
    `total_count` - total number of resources you have
    <br/>
    `page_size` - 30 by default or the value you put in `page[size]`
    <br/>
    `max_page_size` - 200

An example of how to use pagination:
    <br/>
    Sending `page[number]=2` and `page[size]=15` will result in seeing resources from 16 to 30 on page 2,
        and the total_pages number will be `total_count`/15 rounded up.
