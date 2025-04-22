# CorsNova

A lightweight and efficient CORS proxy server built with Express.js that helps bypass CORS restrictions during development and testing.

## Core Features

- **Universal CORS Bypass**: Handles CORS for any target URL.
- **Multiple Content Type Support**:
  - `application/json`
  - `application/x-www-form-urlencoded`
  - `multipart/form-data`
- **Header Management**:
  - Forwards custom request headers prefixed with `x-` (e.g., `x-authorization` becomes `Authorization` in the forwarded request).
  - Forwards response headers from the target server back to the client, prefixed with `Forward-` (e.g., `Content-Type` becomes `Forward-Content-Type`).
  - Forwards cookies from the client request to the target server.
- **File Operations**:
  - Handles file uploads (`multipart/form-data`) using `multer`.
  - Streams responses from the target server back to the client.
  - Supports large request bodies (up to 10GB limit).

## Installation

1.  Install [Node.js](https://nodejs.org/).
2.  Clone this repository.
3.  Run `npm install` in the repository directory.
4.  Start the application with `node app.js` or `npm run start`.
5.  The server will run on the port specified by the `PORT` environment variable, or 3030 by default.

## Usage

Send your request to the CorsNova server, specifying the target URL in one of two ways:

1.  **Using a query parameter:**
    `http://localhost:3030/?url=<encoded_target_url>`
    Example: `http://localhost:3030/?url=https%3A%2F%2Fexample.com%2Fapi%2Fdata`

2.  **Using the path:**
    `http://localhost:3030/<target_url>`
    Example: `http://localhost:3030/https://example.com/api/data`

*Note: If both the path and the `url` query parameter are provided, the `url` query parameter takes precedence.*

CorsNova will forward your request (including method, headers prefixed with `x-`, cookies, and body) to the target URL and stream the response back, adding the `Forward-` prefix to the original response headers.

## Example

To send a POST request with a custom `Authorization` header and form data to `https://www.example.com`:

```javascript
const formData = new FormData();
formData.append('key1', 'value1');
formData.append('key2', 'value2');
// Append files if needed
// formData.append('myFile', fileInputElement.files[0]);

fetch('http://localhost:3030/?url=https%3A%2F%2Fwww.example.com', {
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

This app was inspired by `allOrigins` by gnuns and `cors-anywhere` by Rob Wu.


