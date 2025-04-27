# CorsNova
<p align="center">
  <img src="images/corsnova_image_aigen.webp" alt="CorsNova Image" style="max-height: 300px;">
</p>
A lightweight and efficient CORS proxy server built with Express.js that helps bypass CORS restrictions during development and testing.

## Features

- **Universal CORS Proxy**: Forwards requests to any target URL, bypassing CORS restrictions.
- **Content-Type Support**:
  - `application/json`
  - `application/x-www-form-urlencoded`
  - `multipart/form-data` (file uploads supported)
- **Header Management**:
  - Forwards custom request headers prefixed with `x-` (e.g., `x-authorization` becomes `Authorization`).
  - Forwards cookies from the client to the target server.
  - Forwards all response headers from the target server to the client, prefixed with `Forward-` (e.g., `Content-Type` becomes `Forward-Content-Type`).
- **Streaming**: Streams responses from the target server back to the client.
- **Large Payloads**: Supports request bodies up to 10GB.

## Installation

1. Install [Node.js](https://nodejs.org/).
2. Clone this repository.
3. Run `npm install` in the repository directory.
4. Start the application with `npm run start` or `node app.js`.
5. The server will run on the port specified by the `PORT` environment variable, or `3030` by default.

## Usage

Send your request to the CorsNova server, specifying the target URL as the path:

```
http://localhost:3030/<target_url>
```
Example:
```
http://localhost:3030/https://example.com/api/data
```


### Request Forwarding

- All HTTP methods are supported.
- Request headers prefixed with `x-` are forwarded without the prefix.
- Cookies are forwarded.
- Request body is forwarded as-is, supporting JSON, URL-encoded, and multipart forms (including files).

### Response Forwarding

- All response headers from the target server are sent back to the client, prefixed with `Forward-`.
- The response body is streamed directly to the client.

## Example

To send a POST request with a custom `Authorization` header and form data to `https://www.example.com`:

```javascript
const formData = new FormData();
formData.append('key1', 'value1');
formData.append('key2', 'value2');
// Append files if needed
// formData.append('myFile', fileInputElement.files[0]);

fetch('http://localhost:3030/https://www.example.com', {
  method: 'POST',
  headers: {
    // Prefix custom headers with 'x-'
    'x-authorization': 'Bearer YOUR_TOKEN_HERE'
    // Other standard headers like 'Accept' are passed through automatically
    // 'Content-Type' for multipart/form-data is handled by the browser/fetch
  },
  body: formData
})
.then(response => {
  // Access forwarded headers using the 'Forward-' prefix
  console.log('Forwarded Content-Type:', response.headers.get('Forward-Content-Type'));
  return response.json(); // or response.text(), response.blob(), etc.
})
.then(data => {
  console.log('Success:', data);
})
.catch(error => {
  console.error('Error:', error);
});
```

The proxy will make a POST request to `https://www.example.com` with the `Authorization: Bearer YOUR_TOKEN_HERE` header and the provided form data.


## License

MIT License

## Acknowledgments

Inspired by [`allOrigins`](https://github.com/gnuns/allOrigins) by gnuns and [`cors-anywhere`](https://github.com/Rob--W/cors-anywhere) by Rob Wu.