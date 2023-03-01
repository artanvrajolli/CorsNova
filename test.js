import fetch from 'node-fetch';
import { PassThrough } from 'stream';
import express from 'express';


const app = express();

// Define a route for the client to request the data
app.get('/data', async (req, res) => {
  try {
    const response = await fetch('https://httpbin.org/anything');

    const stream = new PassThrough();
    response.body.pipe(stream);

    res.set({
      'Content-Type': response.headers.get('content-type'),
      'Transfer-Encoding': 'chunked'
    });

    stream.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

// Start the server and listen for incoming requests

app.listen(3000, () => {
  console.log('Server listening on port 3000');
});