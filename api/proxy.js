import { handleProxy } from '../server/proxy.js';

export const config = { api: { bodyParser: false } };

export default function handler(req, res) {
  return handleProxy(req, res);
}
