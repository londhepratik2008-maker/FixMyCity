import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// On Vercel the root filesystem is read-only except /tmp.
export const uploadsDir = process.env.VERCEL
  ? path.join(os.tmpdir(), 'fmc-uploads')
  : path.join(__dirname, '../../uploads');
