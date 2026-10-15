import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Fayllar test uchun vaqtinchalik papkaga (repo ichidagi storage/ ga emas).
// AppModule import qilinishidan OLDIN ishlashi kerak — ConfigModule env'ni import paytida o'qiydi.
process.env.STORAGE_DIR = mkdtempSync(join(tmpdir(), 'zonup-files-'));
