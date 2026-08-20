<!-- Mirrored from https://developer.productive.io/guides/authorization -- regenerate with `npm run spec:guides` -->

To authorize yourself, add your API token to the **X-Auth-Token** header for every request.

API token can be generated using Productive application, navigating to **Settings** -> **API integrations** -> **Generate new token**

To access your organization data, add your organization ID to the **X-Organization-Id** header for every request.

Most resources have authorization on them. If successfully authorized, you will get a response containing the resource. However, if you aren't authorized then you will be given HTTP status of 403, and an error message.
