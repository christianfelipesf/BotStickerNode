const http = require('http');
http.get('http://127.0.0.1:3092/favicon.ico', r => {
    let buf = Buffer.alloc(0);
    r.on('data', c => buf = Buffer.concat([buf, c]));
    r.on('end', () => {
        console.log('status:', r.statusCode);
        console.log('content-type:', r.headers['content-type']);
        console.log('first 16 bytes hex:', buf.slice(0, 16).toString('hex'));
        console.log('first 16 bytes ascii:', JSON.stringify(buf.slice(0, 16).toString('utf8')));
        console.log('size:', buf.length);
    });
});
