<!-- Mirrored from https://developer.productive.io/guides/working-with-custom-fields -- regenerate with `npm run spec:guides` -->

### Creating custom fields

When working with custom fields, you should first create a new custom field on the desired type of object (which you can specify with the `customizable_type` attribute). For more information about `API requests` for creating and managing custom field objects, check out [API Documentation: Custom fields](https://developer.productive.io/custom_fields.html#custom-fields-custom-fields). 


For this example, we will show how to create a custom field for a deal and populate the value of this custom field for a certain deal object.

First step is creating the custom field object:

`POST https://api.productive.io/api/v2/custom_fields`

The request body should contain information about `customizable_type`, `data_type_id`, and the `name` of the custom field.

```
{
  "data": {
    "type": "custom_fields",
    "attributes": {
      "name": "Review link",
      "data_type_id": 1,
      "customizable_type": "deals"
    }
  }
}
```

After you successfully create a new custom field object, the data part of the response body will contain the `id` of the created custom field.

```
  "data": {
    "id": "307",
    "type": "custom_fields",
    "attributes": {
      "created_at": "2024-05-21T02:03:56.482+02:00",
      "updated_at": "2024-05-21T02:03:56.482+02:00",
      "name": "Review link",
      "data_type_id": 1,
      "required": false,
      "description": null,
      "archived_at": null,
      "aggregation_type_id": null,
      "formatting_type_id": null,
      "global": true,
      "show_in_add_edit_views": true,
      "sensitive": false,
      "position": 1,
      "customizable_type": "deals"
    }
  }
```
<br>

### Filtering custom fields

If you want to retrieve all custom fields, you can do so with this API request:

`GET https://api.productive.io/api/v2/custom_fields`

To add custom fields to objects, they must not be archived. To retrieve available custom fields, you can use this API request:

`GET https://api.productive.io/api/v2/custom_fields?filter[archived]=false`

And if you want to retrieve available custom fields for a specific customizable type, you can do so with this API request:

`GET https://api.productive.io/api/v2/custom_fields?filter[archived]=false&filter[customizable_type]=deals`

For more about filtering please check out [API Documentation: Filtering](https://developer.productive.io/index.html#header-filtering)

### Adding custom fields to the object

To add a custom field to a specific object, you should first retrieve this object and update its custom_fields attribute. 

Remember, the custom_fields attribute on objects is a type of `hash (dictionary)`. To prevent overwriting its values, always retrieve the entire object and add a new key (custom_field_id) to the custom_fields hash. If you remove the key, the custom field value will be lost.

Here is an example of the custom_fields attribute on objects such as people, deals, budgets etc.:

```
{
   "data": {
    "attributes": {
      ...
      "custom_fields": {
        "custom_field_id_1": "value1",
        "custom_field_id_2": 12,
        "custom_field_id_3": ["value3", "value4"],
      }
      ...
    }
  }
}
```
`custom_field_id_1`, `custom_field_id_2`, and `custom_field_id_3` are the ids of the custom field objects.

If the data type is a number, the value should be numerical (`12`), for others the value should be a string (`value1`).
If the data type is multiple select, the value should be an array of string values (`["value3", "value4"]`).

Keep in mind:

For person data type, this value is a person object `id`.
For select and multiple select data types, it is the `id of the custom field option` objects.
 
<br>

**Example**

So the first step is to retrieve the deal object for which we want to update the custom field values.

`GET https://api.productive.io/api/v2/deals/{id}`

In the response body, we receive a custom_fields hash with already existing values.

```
{
  "data": {
    "attributes": {
      ...
        "custom_fields": {
            "63": [
                "70"
                ],
            "156": "code_321"
        }
      ...
    }
  }
}
```
<br>

 If we want to add a new custom field value, we should update this custom_fields hash. Similarly, if we want to change the value or remove a value, then we only need to modify or remove that key-value pair from the hash.

 For example to add the custom field "Review link" to a certain deal with the desired value "https://mylink.com" (assuming its id is 307), you can use the following API request:

 `PATCH https://api.productive.io/api/v2/deals/{id}`

with `request body`:
 ```
{
    "data": {
        "id": "{id}",
        "type": "deals",
        "attributes": {
            "custom_fields": {
                "63": [
                    "70"
                ],
                "156": "code_321",
                "307": "https://mylink.com"
            }
        }
    }
}
```

### Filtering objects by custom fields

You can filter objects such as deals by their custom field values. The correct format for this would be:

`GET https://api.productive.io/api/v2/deals?filter[custom_fields][custom_field_id][operation]=filter_value`

For example, to filter all deals that have the Review Link custom field set as "https://mylink.com", you can make an API call like this:

`GET https://api.productive.io/api/v2/deals?filter[custom_fields][307][eq]=https://mylink.com`

For more information about filtering, please check out the [API Documentation: Filtering](https://developer.productive.io/index.html#header-filtering)
