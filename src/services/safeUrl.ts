/**
 * GV-03: kullanıcıların girdiği ve başka kullanıcıların ekranında tıklanabilir bağlantı olarak
 * çizilen adresler yalnız http(s) şemasıyla kabul edilir (javascript:, data: vb. reddedilir).
 */
export function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
