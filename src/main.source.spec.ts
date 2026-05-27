import { readFileSync } from 'fs';
import { join } from 'path';

describe('main bootstrap source', () => {
  it('hardcodes a larger JSON body limit for large sync batches', () => {
    const source = readFileSync(join(__dirname, 'main.ts'), 'utf8');

    expect(source).toContain('bodyParser: false');
    expect(source).toContain("express.json({ limit: '2mb' })");
    expect(source).toContain("express.urlencoded({ limit: '2mb', extended: true })");
  });
});
