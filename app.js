import express from 'express';
import multer from 'multer';
import fetcher from 'node-fetch';
import { FormData } from 'node-fetch';
const app = express();

const port = process.env.PORT || 3030
function enableCORS(req, res, next) {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*')
    res.header('Access-Control-Allow-Credentials', true)
    res.header(
      'Access-Control-Allow-Headers',
      '*'
    )
    res.header(
      'Access-Control-Allow-Methods',
      'OPTIONS, GET, POST, PATCH, PUT, DELETE'
    )
    next()
  }
app.use(enableCORS);
app.use(express.json());

const upload = multer();

app.use(express.urlencoded({ extended: true }));
app.use('/', upload.any(),async function (req, res) {
    let method = req.method;
    let url = req.query.url;
    if(!url){
        res.status(400).send('URL is required');
        return;
    }
    url = decodeURIComponent(url);
    let data = req?.body ?? {};
    let headers = {};
    let requestHeaderContentType = req.headers['content-type'] ?? "";
    if(requestHeaderContentType.startsWith('multipart/form-data')){
        requestHeaderContentType = 'multipart/form-data';
    }
    switch(requestHeaderContentType){
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
            for(let key in req.body){
                data.append(key,req.body[key]);
            }
            for(let file of req.files){
                data.append(file.fieldname, file.buffer, { filename: file.originalname });
            }
            // headers['Content-Type'] = 'multipart/form-data';
            break;
    }

    // get only custom headers from request
   
    for(let key in req.headers){
        if(key.startsWith('x-')){
            let newKey = key.replace(/^x-/i,'');
            headers[newKey] = req.headers[key];
        }
    }
    
    if(["GET","HEAD"].includes(method)){
        data = null; // remove data 
    }
    try{
       let response = await fetcher(url, {
            method: method,
            headers: headers,
            body:data,
        }).then(async (response) => {
            const buffer = await response.arrayBuffer();
            return {
                body: buffer,
                headers: response.headers,
                status: response.status
            }
        });
       
        res.setHeader("Content-Type",response.headers.get('content-type') || 'text/plain');
        res.send(Buffer.from(response.body));
    }catch(error){
        console.log("Error",error);
        res.status(500).send(error);
        return;
    }
});



app.listen(port,function (){
    console.log("Server is running on port "+port);
});


