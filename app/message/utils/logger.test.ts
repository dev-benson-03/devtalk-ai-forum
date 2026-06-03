import { Logger, LogLevel } from './logger';

describe('Logger', () => {
  let logger: Logger;
  let spy: jest.SpyInstance;

  beforeEach(() => {
    logger = new Logger(LogLevel.DEBUG);
    spy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs debug, info, warn, error', () => {
    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');
    expect(logger.getLogs().length).toBe(4);
  });

  it('filters logs by level', () => {
    logger = new Logger(LogLevel.WARN);
    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');
    const logs = logger.getLogs();
    expect(logs.length).toBe(4);
    expect(logs[0].level).toBe(LogLevel.DEBUG);
    expect(logs[2].level).toBe(LogLevel.WARN);
  });

  it('calls correct console method', () => {
    logger.debug('debug');
    expect(spy).toHaveBeenCalled();
  });

  it('clears logs', () => {
    logger.info('info');
    logger.clearLogs();
    expect(logger.getLogs().length).toBe(0);
  });

  it('shouldLog returns correct value', () => {
    expect((logger as any).shouldLog(LogLevel.DEBUG)).toBe(true);
    logger = new Logger(LogLevel.ERROR);
    expect((logger as any).shouldLog(LogLevel.DEBUG)).toBe(false);
  });

  it('getConsoleMethod returns correct function', () => {
    expect((logger as any).getConsoleMethod(LogLevel.DEBUG)).toBe(console.debug);
    expect((logger as any).getConsoleMethod(LogLevel.INFO)).toBe(console.info);
    expect((logger as any).getConsoleMethod(LogLevel.WARN)).toBe(console.warn);
    expect((logger as any).getConsoleMethod(LogLevel.ERROR)).toBe(console.error);
  });
});
