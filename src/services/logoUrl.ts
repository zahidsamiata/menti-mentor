/**
 * F-04: kurum logosu adresi yalnız `https:` şemasıyla kabul edilir.
 *
 * Neden: logo her üye ekranında `<img src>` olarak çizilir. `http:` karışık içerik uyarısı ve
 * izleme pikseli, `javascript:` / `data:` gibi şemalar ise istenmeyen içerik taşıyabilir.
 * Frontend marka ekranındaki `isSafeLogoUrl` ile aynı kural; bu backend tarafındaki garanti.
 */
import { z } from 'zod';

export const LOGO_URL_MESSAGE = 'Logo adresi https:// ile başlayan geçerli bir adres olmalı.';

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export const logoUrlSchema = z.string().max(2048).refine(isHttpsUrl, { message: LOGO_URL_MESSAGE });
