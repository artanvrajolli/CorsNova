# CorsNova

A lightweight and efficient CORS proxy server built with Express.js that helps bypass CORS restrictions during development and testing.

## Core Features

- **Universal CORS Bypass**: Handles CORS for any target URL
- **Multiple Content Type Support**: 
  - application/json
  - application/x-www-form-urlencoded
  - multipart/form-data
- **Header Management**:
  - Custom header forwarding (prefix with 'x-')
  - Response header preservation
  - Cookie handling
- **File Operations**:
  - File upload support
  - Stream-based response handling
  - Large file handling (10GB limit)

## Installation

1. Install [Node.js](https://nodejs.org/).
2. Clone this repository.
3. Run `npm install` in the repository directory.
4. Start the application with `node app.js` or `npm run start`.
5. Open `http://localhost:3030` in your browser.

## Usage

1. Open `http://localhost:3030/?url=:web` in your browser.
2. Replace `:web` with the URL of the web page you want to bypass CORS on.

## Example

To include an authorization token in your request headers and send a form-data request body with two key-value pairs:
```
const formData = new FormData();
formData.append('key1', 'value1');
formData.append('key2', 'value2');

fetch('http://localhost:3030/?url=https://www.example.com', {
  method: 'POST',
  headers: {
    'x-authorization': 'Basic XXXXX'
  },
  body: formData
});
```
The app will then include the headers and request body in the request it sends on your behalf.

## License
MIT License

## Acknowledgments
This app was inspired by `allOrigins` by gnuns and `cors-anywhere` by Rob Wu.


