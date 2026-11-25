/** Game server base URL (Colyseus and `/api`). Local dev talks to the server started by `npm run dev`. */
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? "http://127.0.0.1:2567";
