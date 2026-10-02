import { handleInspect } from '../server/inspect.js';

export default function handler(req, res) {
  return handleInspect(req, res);
}
