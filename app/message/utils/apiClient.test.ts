import { ApiClient } from './apiClient';

describe('ApiClient', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('sets default config in constructor', () => {
    const client = new ApiClient();
    expect(client).toBeInstanceOf(ApiClient);
  });

  it('makes GET request', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ message: 'ok', data: 123 })
    });
    const client = new ApiClient({ baseUrl: 'http://test' });
    const res = await client.get('endpoint');
    expect(res.data).toEqual({ data: 123, message: 'ok' });  
});

  it('makes POST request', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ message: 'created', data: 'abc' })
    });
    const client = new ApiClient({ baseUrl: 'http://test' });
    const res = await client.post('endpoint', { foo: 'bar' });
    expect(res.data).toEqual({ data: 'abc', message: 'created' });  
});

  it('handles fetch error', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('fail'));
    const client = new ApiClient({ baseUrl: 'http://test' });
    await expect(client.get('endpoint')).rejects.toThrow('fail');
  });

  it('handles non-ok response', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad',
      json: async () => ({ message: 'bad request' })
    });
    const client = new ApiClient({ baseUrl: 'http://test' });
    await expect(client.get('endpoint')).rejects.toThrow('bad request');
  });

  it('builds URL with params', () => {
    const client = new ApiClient({ baseUrl: 'http://test' });
    const url = (client as any).buildUrl('foo', { a: 1, b: 'x' });
    expect(url).toContain('a=1');
    expect(url).toContain('b=x');
  });

  it('updates config', () => {
    const client = new ApiClient({ baseUrl: 'http://test', timeout: 100 });
    client.updateConfig({ timeout: 200 });
    expect((client as any).config.timeout).toBe(200);
  });
});
