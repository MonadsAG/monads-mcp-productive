<!-- Mirrored from https://developer.productive.io/guides/faq -- regenerate with `npm run spec:guides` -->

### General

*Q: Are the API limits on the enterprise plan different from the other plans?*

A: No.

<hr/>

*Q: Do custom fields have a dedicated API or do they use the same API as the module they are added to?*

A: Custom Fields are a combination of custom field attributes and definitions of CFS through `/custom_fields` and `/custom_fields_options`.

<hr/>

*Q: If we use webhooks, do these have any usage limits we should be aware of?*

A: No.

<hr/>

*Q: Is it possible to assign the responsible attribute to a team instead of a person? I did try replacing “people” with type “teams” (and also “team”) but it said the data/attributes/responsible attribute was invalid both times.*

A: No. Responsible attribute (assignee) can’t be a team, only an individual (people).

<hr/>

### Deals (Budgets)

*Q: What's the difference between a Deal and a Budget?*

A: Deal and Budget are on the same `deals` endpoint. Deal in Productive is a prospective project with potential financial outcomes that is still in the sales phase. When a deal is marked as "Won", it can lead to the creation of a new project and a new budget. A budget is a concrete financial plan for a project that has been won or is already underway. A budget is necessary for invoicing and provides a detailed financial overview of a project's performance.

<hr/>

*Q: Can’t update budget to delivered. 
<br/>
I'm trying to setup an API that updates a budget to delivered. I'm using the request body which is exactly the same as the request body in the API Documentation > Deals > Update a Budget. This does not update the budget to delivered (i.e. the "delivered_on" field remains "null").*

A: Send `PATCH` request to `/deals/{id}/close` to close the deal; where the `{id}` is the ID of the deal. 
<br/>Request:

``` json
{
  "data": {
    "type": "deals",
    "attributes": {
      "delivered_on": "2024-03-14"
    }
  }
}
```
is enough to update `delivered_on`. 

Key takeaway:
<br/>
Through PATCH request to `/deals/{id}` you can’t update `delivered_on` if the budget isn’t delivered (closed) already.

<hr/>

*Q: Can’t bulk update budgets and deals.
<br/>
I was wondering if you have an example request for bulk insert? I created 200 budgets/deals without a problem, but I had to make 200 requests. Since the API allows only 100 requests/10s, I had to add a rate limiting on our side.*

A: We do not have the option to bulk create deals/budgets, only for update and delete.

Key takeaway:
<br/>
For bulk actions, in the `Content-Type` header field you need to add the following: `application/vnd.api+json; ext=bulk`. 
This works only for updating and deleting, it does not work for creating deals/budgets.

<hr />

*Q: How to fetch tentative bookings via API?*

A: Apply the relevant filter on bookings endpoint: `/bookings?filter[with_draft]=true&filter[draft]=true`.

<hr/>

*Q: Can’t create a deal. I'm having trouble creating a deal. I’ve used the same company ID that was returned on the creation of a company, but I receive the following error message:* 

``` json
{
    "errors": [
        {
            "status": 422,
            "title": "Invalid Attribute",
            "detail": "can not be internal company",
            "source": {
            	"pointer": "data/attributes/company"
                      }
        }
    ]
}
```

A: For client deals/budgets, you need to send `2` in `deal_type_id` attribute -> `1` is used for internal deals. If you define the deal/budget as internal (`1`), we automatically override the company and set it to your internal company and that is when the validation breaks (deals can’t be created against internal companies). So, you need to send:`"deal_type_id": 2`

Key takeaway:
<br/>
`"deal_type_id": 1` is internal.
<br/>
`"deal_type_id": 2` is client.

<hr/>


### Projects

*Q: Request to reorder properties.
<br/>
I’m retrieving data from the projects endpoint. Most data objects have 2 properties in their JSON: `id` and `type`, which appear in that order. To help us deserialize the JSON efficiently it would be really helpful if the `type` property always appeared as the first property.*

A: JSON, by definition, is not a stored list of values, which means that the order is not important. Additionally, Productive API follows the OpenAPI standard: [JSON](https://jsonapi.org/). We are using built-in libraries to generate JSON responses.

<hr/>

### Reports

*Q: Rate limit reached.
<br/>
We're trying to fetch a lot of records, so we're constantly getting the Rate limit reached. Is there anything we can do better?*

``` json
{
    "errors": [
        {
            "status": 429,
            "title": "Too many requests",
            "detail": "Rate limit reached. Try again later",
            "limit": 10       
        }
    ]
}
```

A: By default, we only return 30 records per page - this can be adjusted up to the max of 200 per request by adding param `page[size]=200`. This will lower the number of requests needed to fetch all the records so the customer shouldn't encounter any throttling errors from our side. 
See [Pagination](https://developer.productive.io/index.html#header-pagination). 

Explanation:
<br/>
All of our `report` endpoints have a stricter rate limit of 10 requests per 30 seconds. This is unfortunately necessary as computations needed for them can be quite expensive in terms of resources so we have to protect our API from any extensive usage. 
See [Rate Limits](https://developer.productive.io/index.html#header-rate-limits).

<hr/>

### Invoices

*Q: Can’t add invoice amount through create invoice method.
<br/>
With the create invoice method, I see it is possible to define currency in the request but not invoice amount?*

A: That should be done through the `line_items` model. For example, when you create a line item that belongs to an invoice, we will automatically update the amount on the invoice.

Key takeaway:
<br/>
Use `line_items` to add invoice amount.

<hr/>

*Q: Linking time_entry to invoice.
<br/>
I'm looking for a way to attribute a `time_entry` to a specific invoice in the data from API.* 

A: The connection between time entries and invoices goes like this invoice -> invoice attribution -> budget -> service -> time entry, which means that you can't attach `time_entry` directly to the invoice, but through `invoice_attribution` it is linked to the budget, which then already has some services that have some time entries.

<hr/>

### Docs

*Q: Can't find docs.*

A: Docs are located on `pages` endpoint.
You can create a doc via API, but can’t insert text in the doc/page via API (text in docs is in JSON format).

<hr/>

### Copy to accounting

*Q: How to copy invoice to accounting integration with API?*

A: First make sure integration existing and is valid. Integration validity and refreshing export options can be done with endpoint:

`GET` -> `/integrations/{INTEGRATION_ID}/check`

Next step is to set copy options on the company of the invoice. Options are different for every accounting tool. Attribute is “settings“ hash field and options are under `“exporter_options“`. Example for Xero:

![image](https://developer.productive.io/img/xero.png)

`PATCH` -> `/companies/{COMPANY_ID}`


``` json
{
    "settings":
        {
    "exporter_options":
    	 	{
            "tax_rate": ,
            "Tax Exempt": ,
            "tax_type":"NONE",
            "xero_invoice_status":"1"                   
        	}
        }
}
```
Company name will be automaticlly matched or created with invoice bill to data.

Final step is to export the invoice with action:

`PATCH` -> `/invoices/{INVOICE_ID}/export`

<hr/>
