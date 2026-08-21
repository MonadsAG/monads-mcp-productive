<!-- Mirrored from https://developer.productive.io/guides/working-with-attachments -- regenerate with `npm run spec:guides` -->

### Uploading attachments

Uploading an attachment is done in **4 steps**:

- 1) Create the attachment object
- 2) Upload the file to S3 storage
- 3) Update the attachment object with the file's storage path
- 4) Link the attachment to the relevant object (e.g., tasks, comments) by updating it with the attachment_id

<br>

---

**Example**:

This example will use case of attaching attachment to a comment in order to showcase all the necessary steps.


**Step 1 - Creating the attachment object**:

`POST https://api.productive.io/api/v2/attachments`

Request body will have to specify information about the attachment; name you want to use, content type, size and attachable_type.

```
{
  "data": {
    "attributes": {
      "name": "file.pdf",
      "content_type": "application/pdf",
      "size": 1234,
      "attachable_type": "comment"
    },
    "type": "attachments"
  }
}
```

<br>

**Step 2 - Uploading the file to S3 storage**:

Response of this request will contain `aws_policy` field with all the necessary information for file upload.

```
"aws_policy": {
  "key": "attachments/files/002/592/959/original/file.pdf",
  "success_action_status": "201",
  "x-amz-algorithm": "AWS4-HMAC-SHA256",
  "x-amz-credential": "AKIAJUS2LA6R66ZPRGVA/20230309/eu-west-1/s3/aws4_request",
  "x-amz-date": "20230309T091615Z",
  "x-amz-signature": "a5f58e21f5a9ceae407c8f183a0e8d8262a5dee4e1283b2db9fef8f975ceadbe",
  "x-amz-security-token": "long_token_value",
  "policy": "long_policy_value",
  "Content-Type": "application/pdf"
}
```

Upload request must contain form data with all the fields from aws_policy and your file.

`POST https://productive-files-production.s3.eu-west-1.amazonaws.com`

Example of the request using curl:

```
curl -X POST \
  -F "key=attachments/files/002/592/959/original/file.pdf" \
  -F "success_action_status=201" \
  -F "x-amz-algorithm=AWS4-HMAC-SHA256" \
  -F "x-amz-credential=AKIAJUS2LA6R66ZPRGVA/20230309/eu-west-1/s3/aws4_request" \
  -F "x-amz-date=20230309T091615Z" \
  -F "Content-Type=application/pdf" \
  -F "x-amz-signature=61ba2467b8ff183ab2c7793b865367a3452bb158fdcf6a96000f1897b08404ee" \
  -F "x-amz-security-token=long_token_value",
  -F "policy=long_policy_value" \
  -F "File=@path/to/file.pdf" \
  https://productive-files-production.s3.eu-west-1.amazonaws.com
```

<br>

**Step 3 - Updating the attachment object with the file's storage path**:

In the response of your file upload you will see an URL inside the Location tag

```
<Location>https://productive-files-production.s3.amazonaws.com/...file.pdf</Location>
```

That URL should be patched into the attachment under temp_url

`PATCH https://api.productive.io/api/v2/attachments/{id}`

```
{
  "data": {
    "attributes": {
      "temp_url": "https://productive-files-production.s3.amazonaws.com/...file.pdf"
    },
    "type": "attachments"
  }
}
```

<br>

**Step 4 - Linking the attachment to the comment by updating it with the attachment_id**:

`PATCH https://api.productive.io/api/v2/comments/{id}`

In the body add attachment in the relationships array:

```
"attachments": {
  "data": [
    {
      "type": "attachments",
      "id": "attachment id"
    }
  ]
}
```

<br>

### Accessing attachments

Accessing attachments programatically requires authentification with the API token.

This is done with query parameter `token` through https://files.productive.io endpoint.

For example:

`GET https://files.productive.io/attachments/files/002/592/959/original/file.pdf?token=f80b89b3-16ab-4958-afdc-6979a4eb2207`

<br>
