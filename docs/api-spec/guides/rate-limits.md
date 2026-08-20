<!-- Mirrored from https://developer.productive.io/guides/rate-limits -- regenerate with `npm run spec:guides` -->

The API utilizes rate limiting to control the number of requests that can be made within a specified time period. This ensures fair usage of resources and prevents abuse or overloading of the server.

The rate limits are structured around `a 100 requests per 10 seconds` with additional limit of `4000 requests per 30 minutes` allowing for occasional bursts of higher request rates in short intervals. If the rate limit is exceeded, the server will respond with an appropriate HTTP status code (e.g., `429 Too Many Requests`), indicating that the client should slow down and comply with the rate limits.

Special consideration is given to the reports endpoint due to its resource-intensive nature. To manage its usage effectively, additional throttling measures are implemented, allowing a maximum of `10 requests within a 30-second` timeframe.
