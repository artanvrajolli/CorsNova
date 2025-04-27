import express from 'express';
import multer from 'multer';
import fetch, { Blob, FormData } from 'node-fetch';
import { PassThrough } from 'stream';

const app = express();

const port = process.env.PORT || 3030
function enableCORS(req, res, next) {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*')
    res.header('Access-Control-Allow-Credentials', true); // Access-Control-Allow-Credentials
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Expose-Headers', '*');
    res.header(
        'Access-Control-Allow-Methods',
        'OPTIONS, GET, POST, PATCH, PUT, DELETE'
    )
    next()
}
app.use(enableCORS);
app.use(express.json({ limit: '10gb' }));
app.use(express.urlencoded({ limit: '10gb', extended: true }));

const upload = multer();

app.options('/:path(*)', (req, res) => {
    res.sendStatus(200);
});

app.use('/:path(*)', upload.any(), async function (req, res) {
    let userAgent = req.headers['x-user-agent'] ?? req.headers['user-agent'] ?? "";
    let method = req.method;
    let url = req.params.path || "";
    let cookies = req.headers.cookie ?? "";
    if (!url) {
        let currentUrl = req.protocol + '://' + req.get('host') + '/';
        res.status(400).send({
            message: `URL parameter is required, example: ${currentUrl}https://example.com`,
            status: 'error'
        });
        return;
    }
    url = decodeURIComponent(url);
    let data = req?.body ?? {};
    let headers = {};
    if (cookies) {
        headers['Cookie'] = cookies;
    }

    let requestHeaderContentType = req.headers['content-type'] ?? "";
    if (requestHeaderContentType.startsWith('multipart/form-data')) {
        requestHeaderContentType = 'multipart/form-data';
    }
    switch (requestHeaderContentType) {
        case 'application/json':
            data = JSON.stringify(data);
            headers['Content-Type'] = 'application/json';
            break;
        case 'application/x-www-form-urlencoded':
            data = new URLSearchParams(data);
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            break;
        case 'multipart/form-data':
            data = new FormData();
            for (let key in req.body) {
                data.append(key, req.body[key]);
            }
            for (let file of req.files) {
                data.append(file.fieldname, new Blob([file.buffer]), { filename: file.originalname });
            }
            // headers['Content-Type'] = 'multipart/form-data';
            break;
    }

    // get only custom headers from request

    for (let key in req.headers) {
        if (key.startsWith('x-')) {
            let newKey = key.replace(/^x-/i, '');
            headers[newKey] = req.headers[key];
        }
    }

    if (["GET", "HEAD"].includes(method)) {
        data = null; // remove data 
    }

    // testing purpose agent remover
    // userAgent = userAgent.replace(/(axios|postman)/i,''); 
    headers['User-Agent'] = userAgent;

    try {
        let response = await fetch(url, {
            method: method,
            headers: headers,
            body: data,
        });

        const stream = new PassThrough();
        response.body.pipe(stream);

        // Set the response headers to indicate that the data is being streamed
        res.set({
            'Content-Type': response.headers.get('content-type'),
            'Transfer-Encoding': 'chunked'
        });
        // add all respnse header as custom header to response with prefix forward-
        for (let key in response.headers.raw()) {
            res.set('Forward-' + key, response.headers.get(key));
        }

        // Pipe the data from the pass-through stream to the response
        stream.pipe(res);
    } catch (error) {
        console.log("Error", error);
        res.status(500).send(error);
        return;
    }
});



app.listen(port, function () {
    console.log("Server is running on port " + port);
});


