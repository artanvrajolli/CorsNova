import express from 'express';
import multer from 'multer';
import fetcher from 'node-fetch';
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
app.use('/', upload.none(),async function (req, res) {
    let method = req.method;
    let url = req.query.url;
    if(!url){
        res.status(400).send('URL is required');
        return;
    }
    url = decodeURIComponent(url);
    let data = req?.body ?? {};
    let headers = {};
    switch(req.headers['content-type']){
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
            headers['Content-Type'] = 'multipart/form-data';
            break;
    }

    // get only custom headers from request
   
    for(let key in req.headers){
        if(key.startsWith('x-')){
            let newKey = key.replace('x-','');
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
            let responseData = null;
            let responseHeaders = response.headers;
            let contentHeader = responseHeaders.get('content-type');
            if(contentHeader === 'application/json'){
                responseData =  await response.json();
            }else if(contentHeader === 'text/html'){
                responseData =  await response.text();   
            }else{
                responseData =   await response.arrayBuffer();
            }

            return {
                body: responseData,
                headers: response.headers,
                status: response.status
            }
        });
        if(response.headers['content-type'] === 'application/json'){
            res.setHeader("Content-Type",'application/json');
        }else{
            res.setHeader("Content-Type",response.headers.get('content-type') || 'application/json');
        }
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


