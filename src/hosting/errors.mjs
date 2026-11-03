export function isolationError() {
  const error = Error('Isolation unavailable; hosted verification refuses in-process execution');
  error.code = 'ISOLATION_UNAVAILABLE';
  error.status = 503;
  return error;
}
