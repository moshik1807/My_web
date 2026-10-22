import { createServer } from './app.js';

const port = Number(process.env.PORT) || 8080;
const { server } = createServer();

server.listen(port, () => {
  console.log(`Party Speaker listening on http://localhost:${port}`);
});
