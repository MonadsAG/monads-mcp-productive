<!-- Mirrored from https://developer.productive.io/guides/filtering -- regenerate with `npm run spec:guides` -->

If you would like to add filtration to your query, you can do that by setting the supported filter parameters in the following way: `?filter[person_id]=24`.
In case you set filter parameter that is not supported for the query, you will get 400 status error:

``` json
{
    "errors": [
        {
            "status": 400,
            "title": "Unsupported Filter",
            "detail": "Filter 'undefined' is not supported on this endpoint"
        }
    ]
}
```

**Filter Operations**

There is also support for different filter operations. Allowed operations are:

- `eq`
- `not_eq`
- `contains`
- `not_contain`
- `gt`
- `gt_eq`
- `lt`
- `lt_eq`

To use operations for filtering, define it after the param name: `?filter[person_id][not_eq]=24`.

NOTE: Not all endpoints support filter operations. If an endpoint supports filter operations, it will be listed in the documentation for that endpoint.

**Logical operation groups**

Endpoints support logical operations as well. The structure for the logical operations are as follows:

```
# logical *operation*
filter[$op]=or|and

# each *operation* can have one or more *operands* denoted by index numbers
filter[{index}][{operand}]

# *operand* can be a direct value
# Example:
filter[$op]=or
filter[0][name][eq]=Productive
filter[1][date][gt]=2024-01-01
filter[2][date][eq]=2023-01-01

# or be another logical operation
# Example:
filter[$op]=or
filter[0][name][eq]=Productive
filter[1][$op]=and
filter[1][0][date][gt]=2024-01-01
filter[1][1][date][eq]=2023-01-01
```

**DateTime filtering**

By default all values sent to date or datetime filters are parsed as `dates` (only their date component is used to do the filtering)

You can get your filter value parsed as datetime by using the `filteringSkipDatetimeCastToDate` flag.

To enable this feature, append the `filteringSkipDatetimeCastToDate` flag to your request header (`X-Feature-Flags`).

This functionality applies **only** to `DateTime` fields (e.g., `created_at`, `updated_at`).
In case it is used on a `Date` field (eg., `end_date` or `start_date`) flag will be ignored and values evaluate as `Dates`.

The table below illustrates how the filter value is interpreted based on whether the `filteringSkipDatetimeCastToDate` flag is enabled or disabled


|   filteringSkipDatetimeCastToDate Flag   |             Value             |  Parsed as   |
| ---------------------------------------- | ----------------------------- | ------------ |
|                Disabled                  |           2024-09-12          |     Date     |
|                Disabled                  | 2024-09-12T10:15:30.000+02.00 |     Date     |
|                Enabled                   |           2024-09-12          |     Date     |
|                Enabled                   | 2024-09-12T10:15:30.000+02.00 |   DateTime   |

Granulation of a filter with datetime value is one second.

NOTE: Filter values are included in the URL and must be properly URL-encoded. For instance, the character `+` should be encoded as `%2B` and `-` as `%2D`
