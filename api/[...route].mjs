import { handle } from "hono/vercel";
import { createApp } from "../server/index.mjs";

const app = createApp({ serveClient: false });
const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
