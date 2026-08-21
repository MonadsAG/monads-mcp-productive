<!-- Mirrored from https://developer.productive.io/guides/pagination -- regenerate with `npm run spec:guides` -->

Pagination has to be set in the following style:

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
