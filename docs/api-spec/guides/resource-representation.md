<!-- Mirrored from https://developer.productive.io/guides/resource-representation -- regenerate with `npm run spec:guides` -->

# Response format

The response format is JSON API. It is a JSON object with:
* a required `data` key, which contains the requested resources
* an optional `meta` key, which contains information about the response
* an optional `links` key, which contains links for pagination
* an optional `included` key, which contains data of related resources

The `data` key can contain a single resource or an array of resources.

Example:

```json
{
  "data": {},
  "meta": {},
  "links": {},
  "included": {}
}
```

# Resource

A resource is an object representing a single entity in the system. It is identified by its type and ID and contains attributes and relationships.

## Attributes

Attributes are the properties of a resource that are not relationships. They can be any valid JSON value.

## Relationships

Relationships are references to other resources that are associated with the current resource. By default, information about these relationships is not included.

## Example:

```json
{
  "data": {
    "id": "1",
    "type": "tasks",
    "attributes": {
      "name": "Task 1",
      "description": "This is a task",
      "due_date": "2023-01-01"
    },
    "relationships": {
      "creator": {
        "meta": { "included": false },
      },
      "project": {
        "meta": { "included": false },
      },
      "parent_task": {
        "meta": { "included": false },
      }
    }
  }
}
```

# Including relationships

To include relationships in the response, you must pass an `include` query parameter which contains a comma-separated list of the desired related resources: `?include=creator,project.project_manager`. This will:

1. Include the identifier data (ID and type) to the `relationships` section of the resource.
2. Include the requested relationship data in the `included` section of the response.
3. If a dot notation is used, it will include the data of the related relationship as well.

If requested resources does not exist, `Unsupported Include` error (with status 400) will be raised:
``` json
{
    "errors": [
        {
            "status": 400,
            "title": "Unsupported Include",
            "detail": "Include 'userz' is not supported on this endpoint"
        }
    ]
}
```

If `include` query parameter is not provided, the response will not include `included` section.

Example:
`GET http://api.productive.io/api/v2/tasks?include=creator,project.project_manager`
```json
{
  "data": {
    "id": "1",
    "type": "tasks",
    "attributes": {
      "name": "Task 1",
      "description": "This is a task",
      "due_date": "2023-01-01"
    },
    "relationships": {
      "creator": {
        "data": {
          "id": "1",
          "type": "people"
        }
      },
      "project": {
        "data": {
          "id": "1",
          "type": "projects"
        }
      },
      "parent_task": {
        "meta": { "included": false }
      }
    }
  },
  "included": [
    {
      "id": "1",
      "type": "people",
      "attributes": {
        "name": "John Doe",
        "email": "john@doe.com"
      }
    },
    {
      "id": "1",
      "type": "projects",
      "attributes": {
        "name": "Project 1",
        "description": "This is a project"
      },
      "relationships": {
        "project_manager": {
          "data": {
            "id": "1",
            "type": "people"
          }
        },
        "workflow": {
          "meta": { "included": false }
        }
      }
    }
  ]
}
```

In the example above, the request asked for the `creator` and `project.project_manager` relationships. The `included` section contains just one "person" because the same person is the creator of the task and also the project_manager of the project and is only included once. Since `parent_task` was not requested, its data is not included.
Also note that to get the `workflow` relationship, the `include` query parameter must contain `project.workflow`, as `workflow` is a relationship of the `project` and not of the `task`.

# Sparse fields
To return a subset of fields of a resource in the response, you must pass an `fields` query parameter which contains an hash of resource types with a comma separated list of wanted fields: `?fields[people]=name,last,company`.
The wanted fields can be any attribute or relationship of a resource.
Fields can also be attributes of a relationship resource, not just the main resource.
If requested field does not exist, backend will ignore that non-existing fields, but will work with others existing fields.
It can also be used with `include` query parameter.

For example:
`GET http://api.productive.io/api/v2/tasks?fields[tasks]=title,creator&fields[people]=first_name,date&include=creator`
results in:
```json
{
  "data": {
    "id": "1",
    "type": "tasks",
    "attributes": {
      "title": "Task 1"
    },
    "relationships": {
      "creator": {
        "data": {
          "id": "1",
          "type": "people"
        }
      }
    }
  },
  "included": [
    {
      "id": "1",
      "type": "people",
      "attributes": {
        "first_name": "John"
      }
    }
  ]
}
```

**NOTE:**
If `include` query contains a relationship that is not present in the `fields` query, the response will include the relationship in the `included` section, but you will not be able to link it to the right resource.
