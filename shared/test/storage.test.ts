import { TempDirStorage } from '../src/storage';

describe('FileSystemStorage / TempDirStorage', () => {
  let storage: TempDirStorage;

  beforeEach(async () => {
    storage = await TempDirStorage.create();
  });

  afterEach(async () => {
    await storage.cleanup();
  });

  it('writes and reads back byte-identical content', async () => {
    const content = Buffer.from('hello video platform');
    await storage.write('originals/a.mp4', content);
    const read = await storage.read('originals/a.mp4');
    expect(read.equals(content)).toBe(true);
  });

  it('creates parent directories on write', async () => {
    await storage.write('renditions/x/720p.mp4', 'data');
    expect(await storage.exists('renditions/x/720p.mp4')).toBe(true);
  });

  it('reports non-existent paths as absent', async () => {
    expect(await storage.exists('nope/missing.mp4')).toBe(false);
  });

  it('moves a file atomically to a new path, creating parent dirs', async () => {
    await storage.write('tmp/y/2k.mp4', 'payload');
    await storage.move('tmp/y/2k.mp4', 'renditions/y/2k.mp4');
    expect(await storage.exists('tmp/y/2k.mp4')).toBe(false);
    expect(await storage.exists('renditions/y/2k.mp4')).toBe(true);
    expect((await storage.read('renditions/y/2k.mp4')).toString()).toBe('payload');
  });

  it('rejects paths that escape the base directory', async () => {
    await expect(storage.write('../escape.txt', 'x')).rejects.toThrow(/escapes storage base/);
  });
});
