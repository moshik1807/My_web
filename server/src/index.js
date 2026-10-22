import http from 'node:http';
import { createApp } from './app.js';
import { attachStream } from './stream.js';

const port = Number(process.env.PORT || 8080);
const server = http.createServer(createApp());
attachStream(server);
server.listen(port, () => console.log(`Vision Window server on http://localhost:${port}`));
