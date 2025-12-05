describe('Basic Tests', () => {
  it('should pass basic assertions', () => {
    expect(1 + 1).toBe(2);
    expect(true).toBe(true);
    expect('hello').toBe('hello');
  });

  it('should handle arrays', () => {
    const arr = [1, 2, 3];
    expect(arr).toHaveLength(3);
    expect(arr.includes(2)).toBe(true);
  });

  it('should handle objects', () => {
    const obj = { key: 'value' };
    expect(obj.key).toBe('value');
  });

  it('should handle numbers', () => {
    expect(2 + 2).toBe(4);
    expect(10 / 2).toBe(5);
  });

  it('should handle strings', () => {
    expect('hello world').toContain('hello');
    expect('test').toHaveLength(4);
  });

  it('should handle dates', () => {
    const date = new Date();
    expect(date).toBeInstanceOf(Date);
    expect(date.getFullYear()).toBeGreaterThan(2020);
  });

  it('should handle async operations', async () => {
    await expect(Promise.resolve('test')).resolves.toBe('test');
    await expect(Promise.reject(new Error('error'))).rejects.toThrow('error');
  });

  it('should handle math operations', () => {
    expect(Math.sqrt(16)).toBe(4);
    expect(Math.pow(2, 3)).toBe(8);
  });

  it('should handle string operations', () => {
    expect('hello'.toUpperCase()).toBe('HELLO');
    expect('WORLD'.toLowerCase()).toBe('world');
  });

  it('should handle boolean operations', () => {
    expect(true && true).toBe(true);
    expect(true || false).toBe(true);
    expect(!false).toBe(true);
  });
});