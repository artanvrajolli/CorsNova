# Node.js CORS Bypass App `CorsNova`

This is a Node.js app that can be used to bypass CORS (Cross-Origin Resource Sharing) requests. CORS is a security measure implemented by web browsers to restrict web pages from making requests to a different domain than the one the web page originated from. This app can be used to allow your web page to make requests to any domain.

The app allows you to send headers with your requests by using the prefix 'x-' followed by the header name. To add a header, simply include it in the headers when making your request, like this: 'x-<headers>'.

You can make a POST request with a request body using one of three formats: form-data, x-www-form-urlencoded, or raw JSON. To send a form-data request body, include the data as key-value pairs in a FormData object and pass it as the body of the request. To send an x-www-form-urlencoded request body, include the data as key-value pairs in the body of the request with a content type of 'application/x-www-form-urlencoded'. To send a raw JSON request body, include the data as a JSON object in the body of the request with a content type of 'application/json'.

For example, if you want to include an authorization token in your request headers and send a form-data request body with two key-value pairs, you can add a header with the name 'x-authorization' and the value of your token, and include the data in a FormData object like this:

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
The app will then include the headers and request body in the request it sends.




## Installation

1. Install Node.js
2. Clone this repository
3. Run `npm install` in the repository directory
4. Run `node app.js` or `npm run start` in the repository directory
5. Open `http://localhost:3030` in your browser

## Usage

1. Open `http://localhost:3030/?url=:web` in your browser
2. `:web` Enter the URL of the web page you want to bypass CORS on

## Example

1. Open `http://localhost:3030/?url=https://www.example.com` in your browser
2. The web page at `https://www.example.com` will be loaded in your browser

## License
MIT License

## Acknowledgments
This app was inspired by `allOrigins` by gnuns and `cors-anywhere` by Rob Wu.


