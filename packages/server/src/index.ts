import { readConfig } from "./config";
import { createGameServer } from "./server";

const { port, host } = readConfig();
const server = createGameServer();
await server.listen(port, host);
console.log(`HelloValley server listening on http://${host}:${port}`);
